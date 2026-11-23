// A tournament's start, the same for every viewer (the server renders it): "Tue 24 Nov,
// 9:00 pm UTC".
const FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function startsAt(at: Date): string {
  return `${FORMAT.format(at)} UTC`;
}
