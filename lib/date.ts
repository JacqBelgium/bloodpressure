import type { Lang } from "./lang";

export function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
