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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  return res.status(200).json({
    available_dates: [
      {
        date: "2026-08-16",
        label: "8/16（日）",
        slots: availableSlots
      },
      {
        date: "2026-08-17",
        label: "8/17（月）",
        slots: availableSlots
      },
      {
        date: "2026-08-18",
        label: "8/18（火）",
        slots: availableSlots
      },
      {
        date: "2026-08-19",
        label: "8/19（水）",
        slots: availableSlots
      },
      {
        date: "2026-08-20",
        label: "8/20（木）",
        slots: availableSlots
      }
    ]
  });
}
