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
  "21:00",
  "21:30"
];

const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

// 水曜定休の場合は 3
// 水曜も表示したい場合は [] に変更
const closedWeekdays = [3];

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      status: "error",
      error: "Method Not Allowed"
    });
  }

  try {
    const availableDates = [];
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      if (closedWeekdays.includes(date.getDay())) {
        continue;
      }

      availableDates.push({
        date: formatDateValue(date),
        label: formatDateLabel(date),
        slots: availableSlots
      });
    }

    return res.status(200).json({
      success: true,
      status: "available",
      available_dates: availableDates
    });
  } catch (error) {
    console.error("Availability error:", error);

    return res.status(500).json({
      success: false,
      status: "error",
      error: error.message || "空き状況の取得に失敗しました。"
    });
  }
}
