import crypto from "crypto";

/* =====================================================
   共通
===================================================== */

function cleanEnv(value) {
  if (!value) return "";

  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "");
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* =====================================================
   Google Access Token
===================================================== */

async function getGoogleAccessToken() {
  const serviceAccountJson = cleanEnv(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  if (!serviceAccountJson) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません。"
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON の形式が正しくありません。"
    );
  }

  if (!serviceAccount.client_email) {
    throw new Error(
      "Googleサービスアカウントの client_email がありません。"
    );
  }

  if (!serviceAccount.private_key) {
    throw new Error(
      "Googleサービスアカウントの private_key がありません。"
    );
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claimSet = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader =
    base64UrlEncode(JSON.stringify(header));

  const encodedClaimSet =
    base64UrlEncode(JSON.stringify(claimSet));

  const unsignedJwt =
    `${encodedHeader}.${encodedClaimSet}`;

  const signer =
    crypto.createSign("RSA-SHA256");

  signer.update(unsignedJwt);
  signer.end();

  const signature =
    signer.sign(
      serviceAccount.private_key,
      "base64"
    );

  const encodedSignature =
    signature
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const signedJwt =
    `${unsignedJwt}.${encodedSignature}`;

  const tokenResponse =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type:
            "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: signedJwt
        })
      }
    );

  const tokenData =
    await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(
      tokenData?.error_description ||
      tokenData?.error ||
      "Googleアクセストークンの取得に失敗しました。"
    );
  }

  return tokenData.access_token;
}

/* =====================================================
   日時
===================================================== */

function createCalendarDateTime(
  visitDate,
  selectedTime
) {
  return `${visitDate}T${selectedTime}:00+09:00`;
}

function addMinutesToDateTime(
  visitDate,
  selectedTime,
  minutesToAdd = 60
) {
  const date = new Date(
    `${visitDate}T${selectedTime}:00+09:00`
  );

  date.setMinutes(
    date.getMinutes() + minutesToAdd
  );

  const formatter =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }
    );

  const values = {};

  for (
    const part of formatter.formatToParts(date)
  ) {
    values[part.type] = part.value;
  }

  return (
    `${values.year}-${values.month}-${values.day}` +
    `T${values.hour}:${values.minute}:${values.second}+09:00`
  );
}

/* =====================================================
   Supabase
===================================================== */

function getSupabaseConfig() {
  let supabaseUrl =
    cleanEnv(process.env.SUPABASE_URL);

  const supabaseKey =
    cleanEnv(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY
    );

  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL が設定されていません。"
    );
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_KEY が設定されていません。"
    );
  }

  /*
    間違って
    https://xxxx.supabase.co/rest/v1
    を環境変数に入れていても修正
  */

  supabaseUrl =
    supabaseUrl
      .replace(/\/rest\/v1\/?$/i, "")
      .replace(/\/+$/, "");

  let parsedUrl;

  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(
      "SUPABASE_URL の形式が正しくありません。"
    );
  }

  if (
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error(
      "SUPABASE_URL は https:// から始まる必要があります。"
    );
  }

  return {
    supabaseUrl,
    supabaseKey
  };
}

async function saveReservationToSupabase(
  reservation
) {
  const {
    supabaseUrl,
    supabaseKey
  } = getSupabaseConfig();

  const endpoint =
    `${supabaseUrl}/rest/v1/reservations`;

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization:
            `Bearer ${supabaseKey}`,
          "Content-Type":
            "application/json",
          Prefer:
            "return=representation"
        },
        body: JSON.stringify({
          visit_date:
            reservation.visit_date,

          selected_time:
            reservation.selected_time,

          people_count:
            reservation.people_count,

          customer_name:
            reservation.customer_name,

          phone_number:
            reservation.phone_number,

          email:
            reservation.email,

          curry_type:
            reservation.curry_type,

          spice_level:
            reservation.spice_level,

          rice_size:
            reservation.rice_size,

          topping:
            reservation.topping,

          quantity:
            reservation.quantity,

          allergy:
            reservation.allergy,

          request_note:
            reservation.request_note,

          status: "pending"
        })
      }
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      text ||
      "Supabaseへの予約保存に失敗しました。"
    );
  }

  return Array.isArray(data)
    ? data[0]
    : data;
}

async function updateSupabaseReservation(
  reservationId,
  values
) {
  if (!reservationId) return;

  const {
    supabaseUrl,
    supabaseKey
  } = getSupabaseConfig();

  const endpoint =
    `${supabaseUrl}` +
    `/rest/v1/reservations` +
    `?id=eq.${encodeURIComponent(reservationId)}`;

  const response =
    await fetch(
      endpoint,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization:
            `Bearer ${supabaseKey}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(values)
      }
    );

  if (!response.ok) {
    console.error(
      "Supabase update failed:",
      await response.text()
    );
  }
}

/* =====================================================
   Google Calendar
===================================================== */

async function checkCalendarAvailability({
  accessToken,
  calendarId,
  visit_date,
  selected_time
}) {
  const startDateTime =
    createCalendarDateTime(
      visit_date,
      selected_time
    );

  const endDateTime =
    addMinutesToDateTime(
      visit_date,
      selected_time,
      60
    );

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/` +
    `${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${encodeURIComponent(startDateTime)}` +
    `&timeMax=${encodeURIComponent(endDateTime)}` +
    `&singleEvents=true`;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Googleカレンダーの空き確認に失敗しました。"
    );
  }

  const events =
    (data.items || []).filter(
      event =>
        event.status !== "cancelled" &&
        event.start?.dateTime &&
        event.end?.dateTime
    );

  if (events.length > 0) {
    const error =
      new Error(
        "選択した時間はすでに予約されています。別の時間を選択してください。"
      );

    error.statusCode = 409;

    throw error;
  }
}

async function createGoogleCalendarEvent(
  reservation
) {
  const calendarId =
    cleanEnv(
      process.env.GOOGLE_CALENDAR_ID
    );

  if (!calendarId) {
    throw new Error(
      "GOOGLE_CALENDAR_ID が設定されていません。"
    );
  }

  const accessToken =
    await getGoogleAccessToken();

  await checkCalendarAvailability({
    accessToken,
    calendarId,
    visit_date:
      reservation.visit_date,
    selected_time:
      reservation.selected_time
  });

  const startDateTime =
    createCalendarDateTime(
      reservation.visit_date,
      reservation.selected_time
    );

  const endDateTime =
    addMinutesToDateTime(
      reservation.visit_date,
      reservation.selected_time,
      60
    );

  const description = [
    `予約ID：${reservation.reservation_id || ""}`,
    `お名前：${reservation.customer_name}様`,
    `電話番号：${reservation.phone_number}`,
    `メール：${reservation.email}`,
    `人数：${reservation.people_count}名`,
    `カレー：${reservation.curry_type}`,
    `辛さ：${reservation.spice_level}`,
    `ライス：${reservation.rice_size}`,
    `トッピング：${reservation.topping}`,
    `数量：${reservation.quantity}個`,
    `アレルギー：${reservation.allergy}`,
    `その他：${reservation.request_note}`
  ].join("\n");

  const event = {
    summary:
      `予約｜${reservation.customer_name}様` +
      `｜${reservation.people_count}名` +
      `｜${reservation.selected_time}`,

    description,

    start: {
      dateTime: startDateTime,
      timeZone: "Asia/Tokyo"
    },

    end: {
      dateTime: endDateTime,
      timeZone: "Asia/Tokyo"
    }
  };

  const response =
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/` +
      `${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(event)
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Googleカレンダーへの予約登録に失敗しました。"
    );
  }

  return data;
}

/* =====================================================
   Dify
===================================================== */

async function sendToDify(
  reservation
) {
  const difyApiKey =
    cleanEnv(
      process.env.DIFY_API_KEY
    );

  if (!difyApiKey) {
    console.warn(
      "DIFY_API_KEY が未設定のためDifyをスキップしました。"
    );

    return null;
  }

  let difyApiUrl =
    cleanEnv(
      process.env.DIFY_API_URL
    ) ||
    "https://api.dify.ai/v1/chat-messages";

  try {
    new URL(difyApiUrl);
  } catch {
    console.error(
      "DIFY_API_URL が不正です。"
    );

    return null;
  }

  try {
    const response =
      await fetch(
        difyApiUrl,
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${difyApiKey}`,
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            inputs: {
              ...reservation
            },

            query:
              "予約フォームから送信されました。入力内容を確認してください。",

            response_mode:
              "blocking",

            conversation_id:
              "",

            user:
              `reservation-${Date.now()}`
          })
        }
      );

    const text =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error(
        "Dify error:",
        data || text
      );

      return null;
    }

    return data;

  } catch (error) {

    /*
      Dify障害だけで予約受付を止めない
    */

    console.error(
      "Dify fetch error:",
      error
    );

    return null;
  }
}

/* =====================================================
   Apps Script / Spreadsheet
===================================================== */

async function sendToAppsScript(
  reservation
) {
  const appsScriptUrl =
    cleanEnv(
      process.env.APPS_SCRIPT_WEB_APP_URL
    );

  if (!appsScriptUrl) {
    throw new Error(
      "APPS_SCRIPT_WEB_APP_URL が設定されていません。"
    );
  }

  try {
    new URL(appsScriptUrl);
  } catch {
    throw new Error(
      "APPS_SCRIPT_WEB_APP_URL の形式が正しくありません。"
    );
  }

  const response =
    await fetch(
      appsScriptUrl,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            reservation
          ),

        redirect: "follow"
      }
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /*
        Apps ScriptがJSON以外を返した場合
        予約自体はカレンダー登録済みなので
        致命的エラーにはしない
      */

      console.warn(
        "Apps Script returned non JSON:",
        text
      );

      return {
        success: true,
        warning:
          "Apps Script response was not JSON"
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      "スプレッドシートへの送信に失敗しました。"
    );
  }

  return data;
}

/* =====================================================
   API
===================================================== */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      confirmed: false,
      success: false,
      error:
        "Method Not Allowed"
    });
  }

  let supabaseReservation = null;
  let calendarEvent = null;

  try {

    const {
      visit_date,
      selected_time,
      visit_time,
      people_count,
      customer_name,
      phone_number,
      email,
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity,
      allergy,
      request_note
    } = req.body || {};

    const selectedTime =
      selected_time ||
      visit_time;

    /* ---------------------------------
       必須項目
    ---------------------------------- */

    if (
      !visit_date ||
      !selectedTime ||
      !people_count ||
      !customer_name ||
      !phone_number ||
      !email ||
      !curry_type ||
      !spice_level ||
      !rice_size ||
      !topping ||
      !quantity ||
      !allergy
    ) {
      return res.status(400).json({
        confirmed: false,
        success: false,
        status:
          "invalid_request",
        message:
          "必須項目をすべて入力してください。"
      });
    }

    const reservation = {
      visit_date,
      selected_time:
        selectedTime,

      people_count:
        Number(people_count),

      customer_name:
        String(customer_name),

      phone_number:
        String(phone_number),

      email:
        String(email),

      curry_type:
        String(curry_type),

      spice_level:
        String(spice_level),

      rice_size:
        String(rice_size),

      topping:
        String(topping),

      quantity:
        Number(quantity),

      allergy:
        String(allergy),

      request_note:
        request_note ||
        "追加事項なし"
    };

    /* ---------------------------------
       Dify
       AI障害では予約を止めない
    ---------------------------------- */

    const difyData =
      await sendToDify(
        reservation
      );

    /* ---------------------------------
       Supabase
       まず pending で保存
    ---------------------------------- */

    supabaseReservation =
      await saveReservationToSupabase(
        reservation
      );

    const reservationId =
      supabaseReservation?.id ||
      "";

    reservation.reservation_id =
      reservationId;

    /* ---------------------------------
       Google Calendar
       ここで予約確定
    ---------------------------------- */

    calendarEvent =
      await createGoogleCalendarEvent(
        reservation
      );

    /*
      Googleカレンダーに入った時点で
      お客様の予約は成立と判断
    */

    await updateSupabaseReservation(
      reservationId,
      {
        status:
          "confirmed",

        calendar_event_id:
          calendarEvent.id
      }
    );

    /* ---------------------------------
       Spreadsheet / Apps Script

       ここが失敗しても
       「予約失敗」にはしない
    ---------------------------------- */

    let spreadsheetWarning = null;

    try {

      await sendToAppsScript(
        reservation
      );

    } catch (error) {

      console.error(
        "Apps Script error:",
        error
      );

      spreadsheetWarning =
        error.message;
    }

    /* ---------------------------------
       成功
    ---------------------------------- */

    return res
      .status(200)
      .json({
        confirmed:
          true,

        success:
          true,

        status:
          "confirmed",

        message:
          "ご予約ありがとうございます。ご来店お待ちしております。",

        reservation_id:
          reservationId,

        visit_date,

        selected_time:
          selectedTime,

        people_count:
          Number(people_count),

        customer_name,

        email,

        curry_type,

        spice_level,

        rice_size,

        topping,

        quantity:
          Number(quantity),

        allergy,

        request_note:
          reservation.request_note,

        calendar_event_id:
          calendarEvent?.id ||
          "",

        answer:
          difyData?.answer ||
          "",

        warning:
          spreadsheetWarning
      });

  } catch (error) {

    console.error(
      "Reservation error:",
      error
    );

    /*
      カレンダー登録済みなら
      予約失敗扱いにしない
    */

    if (calendarEvent?.id) {

      return res
        .status(200)
        .json({
          confirmed:
            true,

          success:
            true,

          status:
            "confirmed_with_warning",

          message:
            "予約は確定しています。店舗側のデータ連携処理の一部でエラーが発生しました。",

          calendar_event_id:
            calendarEvent.id
        });
    }

    if (
      supabaseReservation?.id
    ) {
      await updateSupabaseReservation(
        supabaseReservation.id,
        {
          status:
            "failed"
        }
      );
    }

    const statusCode =
      error.statusCode ||
      500;

    return res
      .status(statusCode)
      .json({
        confirmed:
          false,

        success:
          false,

        status:
          "error",

        error:
          error.message ||
          "予約処理中にエラーが発生しました。"
      });
  }
}
