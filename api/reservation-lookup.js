function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

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

    if (!reservation_id || !email || !phone_number) {
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

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Supabaseの環境変数が設定されていません。"
      );
    }

    const headers = {
      apikey: supabaseKey,
      "Content-Type": "application/json"
    };

    // 予約を取得
    const reservationResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservations?reservation_id=eq.${encodeURIComponent(
        reservation_id
      )}&select=*`,
      {
        headers
      }
    );

    const reservations =
      await reservationResponse.json();

    if (
      !reservationResponse.ok ||
      !Array.isArray(reservations) ||
      reservations.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "予約情報が一致しません。"
      });
    }

    const reservation = reservations[0];

    // 顧客を取得
    const customerResponse = await fetch(
      `${supabaseUrl}/rest/v1/customers?customer_id=eq.${encodeURIComponent(
        reservation.customer_id
      )}&select=*`,
      {
        headers
      }
    );

    const customers =
      await customerResponse.json();

    if (
      !customerResponse.ok ||
      !Array.isArray(customers) ||
      customers.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "予約情報が一致しません。"
      });
    }

    const customer = customers[0];

    // 本人確認
    const emailMatched =
      normalizeEmail(customer.email) ===
      normalizeEmail(email);

    const phoneMatched =
      normalizePhone(customer.phone) ===
      normalizePhone(phone_number);

    if (!emailMatched || !phoneMatched) {
      return res.status(403).json({
        success: false,
        message:
          "予約情報が一致しません。予約ID、メールアドレス、電話番号をご確認ください。"
      });
    }

    // メニュー取得
    const itemsResponse = await fetch(
      `${supabaseUrl}/rest/v1/reservation_items?reservation_id=eq.${encodeURIComponent(
        reservation_id
      )}&select=*`,
      {
        headers
      }
    );

    const items = await itemsResponse.json();

    if (!itemsResponse.ok) {
      throw new Error(
        "メニュー情報の取得に失敗しました。"
      );
    }

    return res.status(200).json({
      success: true,

      reservation: {
        reservation_id:
          reservation.reservation_id,

        reservation_date:
          reservation.reservation_date,

        reservation_time:
          reservation.reservation_time,

        party_size:
          reservation.party_size,

        status:
          reservation.status
      },

      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      },

      items: Array.isArray(items)
        ? items
        : []
    });

  } catch (error) {
    console.error(
      "Reservation lookup error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "予約情報の取得に失敗しました。"
    });
  }
}
