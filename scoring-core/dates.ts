/** UTC date helpers. All dates in the dataset are `YYYY-MM-DD` (UTC). */

export const DAY_MS = 86_400_000;
export const DAY_SECONDS = 86_400;

/** `YYYY-MM-DD` → unix seconds at 00:00:00 UTC. */
export function dateToTs(date: string): number {
  return Math.floor(Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  ) / 1000);
}

/** unix seconds → `YYYY-MM-DD` (UTC). */
export function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return tsToDate(dateToTs(date) + days * DAY_SECONDS);
}

export function daysBetween(from: string, to: string): number {
  return (dateToTs(to) - dateToTs(from)) / DAY_SECONDS;
}

/** Inclusive list of every `YYYY-MM-DD` from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
