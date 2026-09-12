import { google } from "googleapis";

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
// 日曜=0, 月曜=1, 火曜=2, 水曜=3, 木曜=4, 金曜=5, 土曜=6
const closedWeekdays = [3];

// 予約1件あたりの枠
// 30分単位で管理するなら 30
const SLOT_MINUTES = 30;

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

function isClosedDate(date) {
  return closedWeekdays.includes(date.getDay());
}

function toJstDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}:00+09:00`);
}

function formatTimeJst(date) {
  return date.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isSameSlot(slotTime, eventStart, eventEnd, dateString) {
  const slotStart = toJstDateTime(dateString, slotTime);
  const slotEnd = addMinutes(slotStart, SLOT_MINUTES);

  return slotStart < eventEnd && slotEnd > eventStart;
}

async function getCalendarClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "";

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"]
  });

  return google.calendar({
    version: "v3",
    auth
  });
}

async function getBookedSlots(calendar, dateString) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const timeMin = `${dateString}T00:00:00+09:00`;
  const timeMax = `${dateString}T23:59:59+09:00`;

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime"
  });

  const events = response.data.items || [];
  const bookedSlots = new Set();

  for (const event of events) {
    if (!event.start || !event.end) continue;

    const eventStartRaw = event.start.dateTime || event.start.date;
    const eventEndRaw = event.end.dateTime || event.end.date;

    if (!eventStartRaw || !eventEndRaw) continue;

    const eventStart = new Date(eventStartRaw);
    const eventEnd = new Date(eventEndRaw);

    for (const slot of availableSlots) {
      if (isSameSlot(slot, eventStart, eventEnd, dateString)) {
        bookedSlots.add(slot);
      }
    }
  }

  return bookedSlots;
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
    const calendar = await getCalendarClient();

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      if (isClosedDate(date)) {
        continue;
      }

      const dateString = formatDateValue(date);
      const bookedSlots = await getBookedSlots(calendar, dateString);

      const slots = availableSlots.filter((slot) => {
        return !bookedSlots.has(slot);
      });

      // 空き時間が1つもない日は表示しない
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
    console.error("Availability error:", error);

    return res.status(500).json({
      success: false,
      status: "error",
      error: error.message || "空き時間の取得に失敗しました。"
    });
  }
}
