import crypto from "crypto";

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsignedJwt}.${encodedSignature}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new Error(
      tokenData.error_description ||
        tokenData.error ||
        "Googleアクセストークンの取得に失敗しました。"
    );
  }

  return tokenData.access_token;
}

function createCalendarDateTime(visitDate, selectedTime) {
  return `${visitDate}T${selectedTime}:00+09:00`;
}

function addMinutesToDateTime(visitDate, selectedTime, minutesToAdd = 60) {
  const date = new Date(`${visitDate}T${selectedTime}:00+09:00`);
  date.setMinutes(date.getMinutes() + minutesToAdd);

  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+09:00`;
}

async function createGoogleCalendarEvent({
  visit_date,
  people_count,
  customer_name,
  phone_number,
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

  const startDateTime = createCalendarDateTime(
    visit_date,
    selected_time
  );

  const endDateTime = addMinutesToDateTime(
    visit_date,
    selected_time,
    60
  );

  const description = [
    `お名前：${customer_name}様`,
    `電話番号：${phone_number}`,
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    const {
      visit_date,
      people_count,
      customer_name,
      phone_number,
      selected_time,
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity,
      allergy,
      request_note
    } = req.body;

    if (
      !visit_date ||
      !people_count ||
      !customer_name ||
      !phone_number
    ) {
      return res.status(400).json({
        error: "来店予定日、人数、お名前、電話番号は必須です。"
      });
    }

    if (
      !selected_time ||
      !curry_type ||
      !spice_level ||
      !rice_size ||
      !topping ||
      !quantity ||
      !allergy
    ) {
      return res.status(400).json({
        error: "希望時間とメニュー内容を入力してください。"
      });
    }

    const difyApiKey = process.env.DIFY_API_KEY;
    const difyApiUrl =
      process.env.DIFY_API_URL ||
      "https://api.dify.ai/v1/chat-messages";

    if (!difyApiKey) {
      return res.status(500).json({
        error: "DIFY_API_KEY が設定されていません。"
      });
    }

    const difyPayload = {
      inputs: {
        visit_date,
        people_count,
        customer_name,
        phone_number,
        selected_time,
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
        error:
          difyData.message ||
          "Dify APIへの送信に失敗しました。",
        details: difyData
      });
    }

    const calendarEvent = await createGoogleCalendarEvent({
      visit_date,
      people_count,
      customer_name,
      phone_number,
      selected_time,
      curry_type,
      spice_level,
      rice_size,
      topping,
      quantity,
      allergy,
      request_note
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
    selected_time,
    people_count,
    customer_name,
    phone_number,
    curry_type,
    spice_level,
    rice_size,
    topping,
    quantity,
    allergy,
    request_note: request_note || "追加事項なし"
  })
});

if (!notificationResponse.ok) {
  throw new Error("店舗への予約通知に失敗しました。");
}

const notificationData = await notificationResponse.json();

if (notificationData.success !== true) {
  throw new Error(
    notificationData.error || "店舗への予約通知に失敗しました。"
  );
}    
    return res.status(200).json({
      confirmed: true,
      status: "confirmed",
      message:
        "ご予約ありがとうございます。ご来店お待ちしております。",
      answer: difyData.answer || "",
      conversation_id: difyData.conversation_id || "",
      message_id: difyData.message_id || "",
      calendar_event_id: calendarEvent.id || ""
    });
  } catch (error) {
    console.error("Reservation error:", error);

    return res.status(500).json({
      confirmed: false,
      status: "error",
      error:
        error.message ||
        "予約処理中にエラーが発生しました。"
    });
  }
}
