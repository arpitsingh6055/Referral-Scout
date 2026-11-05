import type { CampaignSettings } from "./schemas";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
export function localTime(at = Date.now()) {
  const p = Object.fromEntries(formatter.formatToParts(at).map(v => [v.type, v.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday ?? "" };
}
export function sendingDay(day: string, holidays: string[]): boolean {
  const weekday = new Date(`${day}T12:00:00+05:30`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.includes(day);
}
export function inWindow(s: CampaignSettings, at = Date.now()): boolean {
  const t = localTime(at); return sendingDay(t.day, s.holidays) && t.time >= s.windowStart && t.time < s.windowEnd;
}
export function ramp(day: number, maximum = 25): number { return Math.min(maximum, day <= 3 ? 5 : day <= 7 ? 10 : day <= 14 ? 15 : 20, 25); }
export function addSendingDays(at: number, count: number, holidays: string[]): number {
  let date = new Date(`${localTime(at).day}T10:00:00+05:30`);
  while (count > 0) { date = new Date(date.valueOf() + 86400000); if (sendingDay(localTime(date.valueOf()).day, holidays)) count--; }
  return date.valueOf();
}
export function sendSlots(day: string, s: CampaignSettings, cap: number, random = Math.random): number[] {
  const start = Date.parse(`${day}T${s.windowStart}:00+05:30`), end = Date.parse(`${day}T${s.windowEnd}:00+05:30`);
  const width = (end - start) / cap;
  return Array.from({ length: cap }, (_, i) => Math.floor(start + width * (i + 0.1 + random() * 0.8)));
}
