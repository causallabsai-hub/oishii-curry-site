import crypto from "crypto";

const availableSlots = [
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00"
];

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

// 水曜定休
// 日曜=0, 月曜=1, 火曜=2, 水曜=3, 木曜=4, 金曜=5, 土曜=6
const closedWeekdays = [3];

// 予約枠の長さ
// reservation.js が60分で登録しているため、空き判定も60分
const RESERVATION_MINUTES = 60;

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

function formatDateValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];

  return `${month}/${day}（${weekday}）`;
}

async function getCalendarEvents({
  accessToken,
  calendarId,
  dateString
}) {
  const timeMin = `${dateString}T00:00:00+09:00`;
  const timeMax = `${dateString}T23:59:59+09:00`;

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events` +
    `?timeMin=${encodeURIComponent(timeMin)}` +
    `&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true` +
    `&orderBy=startTime`;

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
        "Googleカレンダーの予定取得に失敗しました。"
    );
  }

  return data.items || [];
}

function getAvailableSlotsForDate(dateString, events) {
  const bookedEvents = events
    .filter((event) => {
      if (event.status === "cancelled") {
        return false;
      }

      if (!event.start || !event.end) {
        return false;
      }

      // 終日予定は除外
      if (!event.start.dateTime || !event.end.dateTime) {
        return false;
      }

      return true;
    })
    .map((event) => {
      return {
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime)
      };
    });

  return availableSlots.filter((slot) => {
    const slotStart = new Date(`${dateString}T${slot}:00+09:00`);

    const slotEnd = new Date(
      slotStart.getTime() + RESERVATION_MINUTES * 60 * 1000
    );

    const isBooked = bookedEvents.some((event) => {
      return slotStart < event.end && slotEnd > event.start;
    });

    return !isBooked;
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      status: "error",
      error: "Method Not Allowed"
    });
  }

  try {
    const serviceAccountJson =
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    const calendarId =
      process.env.GOOGLE_CALENDAR_ID;

    if (!serviceAccountJson) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません。"
      );
    }

    if (!calendarId) {
      throw new Error(
        "GOOGLE_CALENDAR_ID が設定されていません。"
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

    const accessToken =
      await getGoogleAccessToken(serviceAccount);

    const today = new Date();
    const availableDates = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);

      date.setDate(today.getDate() + i);

      // 水曜定休
      if (closedWeekdays.includes(date.getDay())) {
        continue;
      }

      const dateString =
        formatDateValue(date);

      const events =
        await getCalendarEvents({
          accessToken,
          calendarId,
          dateString
        });

      const slots =
        getAvailableSlotsForDate(
          dateString,
          events
        );

      // 空き時間がない日は表示しない
      if (slots.length === 0) {
        continue;
      }

      availableDates.push({
        date: dateString,
        label: formatDateLabel(date),
        slots
      });
    }

    return res.status(200).json({
      success: true,
      status: "available",
      available_dates: availableDates
    });

  } catch (error) {
    console.error(
      "Availability error:",
      error
    );

    return res.status(500).json({
      success: false,
      status: "error",
      message:
        "空き状況を取得できませんでした。",
      error:
        error.message ||
        "空き状況の取得に失敗しました。"
    });
  }
}
