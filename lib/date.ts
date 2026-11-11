import type { Lang } from "./lang";

export function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getIsoWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

export const APP_TIME_ZONE = "Europe/Brussels";

// Calendar date of `date` in `timeZone`, as a Date at local midnight. The other
// helpers in this file read local date parts, so passing them this value gives
// the right answer for that time zone regardless of the server's own zone.
export function getCalendarDateInZone(date: Date, timeZone: string = APP_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(part("year"), part("month") - 1, part("day"));
}

export function getIsoWeekInZone(
  date: Date,
  timeZone: string = APP_TIME_ZONE,
): { isoYear: number; isoWeek: number; calendarDate: Date } {
  const calendarDate = getCalendarDateInZone(date, timeZone);
  return {
    isoYear: getIsoWeekYear(calendarDate),
    isoWeek: getIsoWeekNumber(calendarDate),
    calendarDate,
  };
}

export function getIsoWeekRange(date: Date): { start: Date; end: Date } {
  const day = date.getDay() || 7; // Monday = 1 .. Sunday = 7
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

export function formatWeekRange(start: Date, end: Date, lang: Lang): string {
  const locale = lang === "nl" ? "nl-NL" : "en-US";
  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = start.toLocaleDateString(locale, { month: "long" });
  const endMonth = end.toLocaleDateString(locale, { month: "long" });

  if (startMonth === endMonth) {
    return lang === "nl"
      ? `${startDay} - ${endDay} ${startMonth}`
      : `${startMonth} ${startDay} - ${endDay}`;
  }

  return lang === "nl"
    ? `${startDay} ${startMonth} - ${endDay} ${endMonth}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}
