/** Settings → Sunday is the first day of the week */

export function sundayIsFirstDayOfWeek(config: { sundayIsTheFirstDayOfTheWeek?: boolean | string }): boolean {
  const v = config.sundayIsTheFirstDayOfTheWeek;
  return v === true || v === 'true' || v === '1';
}

/** Start of the calendar week containing `date` (local midnight). */
export function startOfConfiguredWeek(
  date: Date,
  config: { sundayIsTheFirstDayOfTheWeek?: boolean | string },
): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday
  const sundayFirst = sundayIsFirstDayOfWeek(config);
  const offset = sundayFirst ? day : (day + 6) % 7; // Mon=0 when Monday-first
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** True when `ts` falls in the configured current week (after "Today"). */
export function isInConfiguredThisWeek(
  ts: number,
  config: { sundayIsTheFirstDayOfTheWeek?: boolean | string },
  now = Date.now(),
): boolean {
  if (!ts || Number.isNaN(ts)) return false;
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  if (ts >= startToday.getTime()) return false; // Today bucket owns this
  const weekStart = startOfConfiguredWeek(new Date(now), config).getTime();
  return ts >= weekStart && ts < startToday.getTime();
}

export function weekdayHeadersShort(
  config: { sundayIsTheFirstDayOfTheWeek?: boolean | string },
): string[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return sundayIsFirstDayOfWeek(config) ? days : [...days.slice(1), days[0]];
}
