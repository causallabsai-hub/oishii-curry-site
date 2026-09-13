import crypto from "crypto";

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getGoogleAccessToken(serviceAccount) {
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

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));

  const unsignedJwt = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();

  const signature = signer.sign(serviceAccount.private_key, "base64");

  const encodedSignature = signature
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const signedJwt = `${unsignedJwt}.${encodedSignature}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt
    })
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(
      tokenData?.error_description ||
        tokenData?.error ||
        "Googleアクセストークンの取得に失敗しました。"
    );
  }

  return tokenData.access_token;
}

function createCalendarDateTime(visitDate, selectedTime) {
  return `${visitDate}T${selectedTime}:00+09:00`;
}

function addMinutesToDateTime(visitDate, selectedTime, minutes) {
  const start = new Date(createCalendarDateTime(visitDate, selectedTime));
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  return end.toISOString();
}

function isOverlapping(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

async function checkCalendarConflict({
  accessToken,
  calendarId,
  visit_date,
  selected_time
}) {
  const startDateTime = createCalendarDateTime(visit_date, selected_time);
  const endDateTime = addMinutesToDateTime(visit_date, selected_time, 60);

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events` +
    `?timeMin=${encodeURIComponent(startDateTime)}` +
    `&timeMax=${encodeURIComponent(endDateTime)}` +
    `&singleEvents=true` +
    `&orderBy=startTime` +
    `&showDeleted=false` +
    `&timeZone=Asia/Tokyo`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Googleカレンダーの予定確認に失敗しました。"
    );
  }

  const events = data.items || [];

  const targetStart = new Date(startDateTime);
  const targetEnd = new Date(endDateTime);

  return events.some((event) => {
    if (event.status === "cancelled") return false;
    if (!event.start || !event.end) return false;
    if (!event.start.dateTime || !event.end.dateTime) return false;

    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);

    return isOverlapping(targetStart, targetEnd, eventStart, eventEnd);
  });
}

async function createGoogleCalendarEvent({
  visit_date,
  people_count,
  customer_name,
  phone_number,
  email,
  selected_time,
  curry_type,
  spice_level,
  rice_size,
  topping,
  quantity,
  allergy,
  request_note
}) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!serviceAccountJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません。");
  }

  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID が設定されていません。");
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON の形式が正しくありません。");
  }

  const accessToken = await getGoogleAccessToken(serviceAccount);

  const isAlreadyBooked = await checkCalendarConflict({
    accessToken,
    calendarId,
    visit_date,
    selected_time
  });

  if (isAlreadyBooked) {
    const error = new Error("選択された時間はすでに予約が入っています。");
    error.statusCode = 409;
    error.status = "already_booked";
    throw error;
  }

  const startDateTime = createCalendarDateTime(visit_date, selected_time);
  const endDateTime = addMinutesToDateTime(visit_date, selected_time, 60);

  const description = [
    `お名前：${customer_name}様`,
    `電話番号：${phone_number}`,
    `メールアドレス：${email}`,
    `人数：${people_count}名`,
    `カレー：${curry_type}`,
    `辛さ：${spice_level}`,
    `ライス：${rice_size}`,
    `トッピング：${topping}`,
    `数量：${quantity}個`,
    `アレルギー：${allergy}`,
    `その他：${request_note || "追加事項なし"}`
  ].join("\n");

  const event = {
    summary: `予約｜${customer_name}様｜${people_count}名｜${selected_time}`,
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

  const calendarResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event)
    }
  );

  const calendarData = await calendarResponse.json();

  if (!calendarResponse.ok) {
    throw new Error(
      calendarData?.error?.message ||
        "Googleカレンダーへの予約登録に失敗しました。"
    );
  }

  return calendarData;
}

function normalizePhone(phoneNumber) {
  return String(phoneNumber || "").replace(/[^0-9]/g, "");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function saveReservationToSupabase({
  visit_date,
  selected_time,
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
  request_note,
  calendar_event_id
}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL が設定されていません。");
  }

  if (!supabaseKey) {
    throw new Error("SUPABASE_ANON_KEY が設定されていません。");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/reservations`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      customer_name,
      phone_number,
      phone_normalized: normalizePhone(phone_number),
      email,
      email_normalized: normalizeEmail(email),
      visit_date,
      selected_time,
      people_count: Number(people_count),
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity: Number(quantity),
      allergy,
      request_note: request_note || "追加事項なし",
      status: "confirmed",
      calendar_event_id
    })
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "SupabaseからJSONではない応答が返りました。SUPABASE_URLとSUPABASE_ANON_KEYを確認してください。"
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.details ||
        "Supabaseへの予約保存に失敗しました。"
    );
  }

  return Array.isArray(data) ? data[0] : data;
}

function getRequestBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error("リクエストJSONの形式が正しくありません。");
    }
  }

  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      confirmed: false,
      success: false,
      status: "error",
      message: "Method Not Allowed"
    });
  }

  try {
    const body = getRequestBody(req);

    const {
      visit_date,
      people_count,
      customer_name,
      phone_number,
      email,
      selected_time,
      visit_time,
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity,
      allergy,
      request_note
    } = body;

    const selectedTime = selected_time || visit_time;

    if (
      !visit_date ||
      !selectedTime ||
      !people_count ||
      !customer_name ||
      !phone_number ||
      !email
    ) {
      return res.status(400).json({
        confirmed: false,
        success: false,
        status: "invalid_request",
        message:
          "来店予定日、希望時間、人数、お名前、電話番号、メールアドレスは必須です。",
        received: {
          visit_date: visit_date || "",
          selected_time: selected_time || "",
          visit_time: visit_time || "",
          people_count: people_count || "",
          customer_name: customer_name || "",
          phone_number: phone_number || "",
          email: email || ""
        }
      });
    }

    if (
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
        status: "invalid_request",
        message: "希望時間とメニュー内容を入力してください。"
      });
    }

    const difyApiKey = process.env.DIFY_API_KEY;
    const difyApiUrl =
      process.env.DIFY_API_URL || "https://api.dify.ai/v1/chat-messages";

    if (!difyApiKey) {
      return res.status(500).json({
        confirmed: false,
        success: false,
        status: "error",
        message: "DIFY_API_KEY が設定されていません。"
      });
    }

    const difyPayload = {
      inputs: {
        visit_date,
        people_count,
        customer_name,
        phone_number,
        email,
        selected_time: selectedTime,
        curry_type,
        spice_level,
        rice_size,
        topping,
        quantity,
        allergy,
        request_note: request_note || "追加事項なし"
      },
      query:
        "予約フォームから送信されました。入力内容をもとに予約作成を進めてください。",
      response_mode: "blocking",
      conversation_id: "",
      user: `reservation-${Date.now()}`
    };

    const difyResponse = await fetch(difyApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${difyApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(difyPayload)
    });

    const difyData = await difyResponse.json();

    if (!difyResponse.ok) {
      return res.status(difyResponse.status).json({
        confirmed: false,
        success: false,
        status: "error",
        message: difyData.message || "Dify APIへの送信に失敗しました。",
        details: difyData
      });
    }

    const calendarEvent = await createGoogleCalendarEvent({
      visit_date,
      people_count,
      customer_name,
      phone_number,
      email,
      selected_time: selectedTime,
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity,
      allergy,
      request_note
    });

    const savedReservation = await saveReservationToSupabase({
      visit_date,
      selected_time: selectedTime,
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
      request_note,
      calendar_event_id: calendarEvent.id || ""
    });

    const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;

    if (!appsScriptUrl) {
      throw new Error("APPS_SCRIPT_WEB_APP_URL が設定されていません。");
    }

    const notificationResponse = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        visit_date,
        selected_time: selectedTime,
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
        request_note: request_note || "追加事項なし",
        reservation_id: savedReservation?.id || "",
        calendar_event_id: calendarEvent.id || ""
      })
    });

    if (!notificationResponse.ok) {
      throw new Error("店舗への予約通知に失敗しました。");
    }

    const notificationText = await notificationResponse.text();

    let notificationData;

    try {
      notificationData = JSON.parse(notificationText);
    } catch {
      throw new Error(
        "Apps ScriptからJSONではない応答が返りました。APPS_SCRIPT_WEB_APP_URLが正しい/execのURLか、Vercelの環境変数が最新か確認してください。"
      );
    }

    if (notificationData.success !== true) {
      throw new Error(
        notificationData.error || "店舗への予約通知に失敗しました。"
      );
    }

    return res.status(200).json({
      confirmed: true,
      success: true,
      status: "confirmed",
      message: "ご予約ありがとうございます。ご来店お待ちしております。",
      reservation_id: savedReservation?.id || "",
      visit_date,
      selected_time: selectedTime,
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
      request_note: request_note || "追加事項なし",
      answer: difyData.answer || "",
      conversation_id: difyData.conversation_id || "",
      message_id: difyData.message_id || "",
      calendar_event_id: calendarEvent.id || ""
    });
  } catch (error) {
    console.error("Reservation error:", error);

    if (error.status === "already_booked") {
      return res.status(409).json({
        confirmed: false,
        success: false,
        status: "already_booked",
        message:
          "選択された時間はすでに予約が入っています。別の時間をお選びください。"
      });
    }

    return res.status(error.statusCode || 500).json({
      confirmed: false,
      success: false,
      status: "error",
      message: "予約処理に失敗しました。",
      error: error.message || "予約処理中にエラーが発生しました。"
    });
  }
}
