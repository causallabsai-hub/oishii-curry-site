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

    if (!visit_date || !people_count || !customer_name || !phone_number) {
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
      process.env.DIFY_API_URL || "https://api.dify.ai/v1/chat-messages";

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
      query: "予約フォームから送信されました。入力内容をもとに予約作成を進めてください。",
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
        error: difyData.message || "Dify APIへの送信に失敗しました。",
        details: difyData
      });
    }

    return res.status(200).json({
      answer: difyData.answer || "",
      conversation_id: difyData.conversation_id || "",
      message_id: difyData.message_id || ""
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "サーバーエラーが発生しました。"
    });
  }
}
