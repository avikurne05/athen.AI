const pad = (value: number) => String(value).padStart(2, '0');

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatLocalDateTimeWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return `${formatLocalDateTime(date)}${offset}`;
}

export function parseLocalDateTime(value: string): Date {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  );

  if (!match) {
    return new Date(value);
  }

  const [, year, month, day, hour, minute, second] = match;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (hasExplicitZone) {
    return new Date(value);
  }

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second || 0)
  );
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function oneMonthAgoSameLocalDay(date: Date): Date {
  const targetMonth = date.getMonth() - 1;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(
    targetYear,
    normalizedMonth,
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

export function normalizeClockTime(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const twentyFourHour = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) {
    return `${pad(Number(twentyFourHour[1]))}:${twentyFourHour[2]}`;
  }

  const twelveHour = text.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i);
  if (!twelveHour) return null;

  let hour = Number(twelveHour[1]) % 12;
  if (twelveHour[3].toLowerCase() === 'pm') hour += 12;
  return `${pad(hour)}:${twelveHour[2] || '00'}`;
}

export function convertTo12Hour(time24: string): string {
  if (!time24) return '';
  const parts = time24.split(':');
  if (parts.length < 2) return time24;
  let hour = parseInt(parts[0], 10);
  const minute = parts[1];
  if (isNaN(hour)) return time24;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12; // the hour '0' should be '12'
  const hourStr = String(hour).padStart(2, '0');
  return `${hourStr}:${minute} ${ampm}`;
}

export function formatTime12Hour(date: Date): string {
  if (!date || isNaN(date.getTime())) return '';
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  return `${hour}:${minute} ${ampm}`;
}
