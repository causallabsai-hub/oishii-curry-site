import crypto from "crypto";

/* ================================
   Google認証
================================ */

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

  const signature = signer.sign(
    serviceAccount.private_key,
    "base64"
  );

  const encodedSignature = signature
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const signedJwt =
    `${unsignedJwt}.${encodedSignature}`;

  const tokenResponse = await fetch(
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

/* ================================
   電話番号・メールの比較用
================================ */

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/* ================================
   Googleカレンダーの予定削除
================================ */

async function deleteGoogleCalendarEvent(
  calendarEventId
) {
  if (!calendarEventId) {
    return;
  }

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
    serviceAccount =
      JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON の形式が正しくありません。"
    );
  }

  const accessToken =
    await getGoogleAccessToken(serviceAccount);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(
      calendarEventId
    )}`,
    {
      method: "DELETE",
      headers: {
        Authorization:
          `Bearer ${accessToken}`
      }
    }
  );

  // 204 = 正常削除
  // 404 = すでに存在しないためキャンセル扱いでOK
  if (
    response.status !== 204 &&
    response.status !== 404
  ) {
    const text = await response.text();

    throw new Error(
      `Googleカレンダーの予約削除に失敗しました。${text}`
    );
  }
}

/* ================================
   メイン処理
================================ */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed"
    });
  }

  try {
    const {
      reservation_id,
      email,
      phone_number
    } = req.body || {};

    if (
      !reservation_id ||
      !email ||
      !phone_number
    ) {
      return res.status(400).json({
        success: false,
        message:
          "予約ID、メールアドレス、電話番号を入力してください。"
      });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl) {
      throw new Error(
        "SUPABASE_URL が設定されていません。"
      );
    }

    if (!supabaseKey) {
      throw new Error(
        "SUPABASE_SECRET_KEY が設定されていません。"
      );
    }

    const headers = {
      apikey: supabaseKey,
      "Content-Type": "application/json"
    };

    /* ================================
       1. 予約を取得
    ================================ */

    const reservationResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations?reservation_id=eq.${encodeURIComponent(
        reservation_id
      )}&select=*`,
      {
        method: "GET",
        headers
      }
    );

    const reservations =
      await reservationResponse.json();

    if (!reservationResponse.ok) {
      throw new Error(
        reservations?.message ||
          "予約情報の取得に失敗しました。"
      );
    }

    if (
      !Array.isArray(reservations) ||
      reservations.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "予約が見つかりませんでした。"
      });
    }

    const reservation =
      reservations[0];

    /* ================================
       2. すでにキャンセル済みか確認
    ================================ */

    if (
      reservation.status === "cancelled"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "この予約はすでにキャンセルされています。"
      });
    }

    /* ================================
       3. 顧客情報を取得
    ================================ */

    const customerResponse = await fetch(
      `${supabaseUrl}/rest/v1/customers?customer_id=eq.${encodeURIComponent(
        reservation.customer_id
      )}&select=*`,
      {
        method: "GET",
        headers
      }
    );

    const customers =
      await customerResponse.json();

    if (!customerResponse.ok) {
      throw new Error(
        customers?.message ||
          "顧客情報の取得に失敗しました。"
      );
    }

    if (
      !Array.isArray(customers) ||
      customers.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "顧客情報が見つかりませんでした。"
      });
    }

    const customer =
      customers[0];

    /* ================================
       4. 本人確認
    ================================ */

    const emailMatched =
      normalizeEmail(customer.email) ===
      normalizeEmail(email);

    const phoneMatched =
      normalizePhone(customer.phone) ===
      normalizePhone(phone_number);

    if (
      !emailMatched ||
      !phoneMatched
    ) {
      return res.status(403).json({
        success: false,
        message:
          "予約情報が一致しません。予約ID、メールアドレス、電話番号をご確認ください。"
      });
    }

    /* ================================
       5. Googleカレンダー削除
    ================================ */

    await deleteGoogleCalendarEvent(
      reservation.calendar_event_id
    );

    /* ================================
       6. Supabaseをキャンセル状態へ
    ================================ */

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations?reservation_id=eq.${encodeURIComponent(
        reservation_id
      )}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "cancelled"
        })
      }
    );

    const updateText =
      await updateResponse.text();

    let updatedReservation = [];

    if (updateText) {
      try {
        updatedReservation =
          JSON.parse(updateText);
      } catch {
        updatedReservation = [];
      }
    }

    if (!updateResponse.ok) {
      throw new Error(
        updatedReservation?.message ||
          updatedReservation?.error ||
          "予約キャンセルの保存に失敗しました。"
      );
    }

    /* ================================
       7. 完了
    ================================ */

    return res.status(200).json({
      success: true,
      status: "cancelled",
      message:
        "予約をキャンセルしました。",
      reservation_id:
        Number(reservation_id)
    });

  } catch (error) {
    console.error(
      "Reservation cancellation error:",
      error
    );

    return res.status(500).json({
      success: false,
      status: "error",
      message:
        error?.message ||
        "予約キャンセル処理に失敗しました。"
    });
  }
}
