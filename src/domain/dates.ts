// Calendar days are YYYYMMDD values. Arithmetic runs on UTC midnights, so
// daylight-saving changes in the viewer's zone never shift a day.
export type Ymd = string & { readonly __brand: 'Ymd' };
export type IanaZone = string & { readonly __brand: 'IanaZone' };

const DAY_MS = 86_400_000;
const YMD_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

export function isYmd(value: string): value is Ymd {
  const match = YMD_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseYmd(value: unknown): Ymd | null {
  return typeof value === 'string' && isYmd(value) ? value : null;
}

function ymdFromParts(year: number, month: number, day: number): Ymd | null {
  const value = `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  return isYmd(value) ? value : null;
}

function utcMs(date: Ymd): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
}

function fromUtcMs(ms: number): Ymd {
  const date = new Date(ms);
  const value = ymdFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  if (value === null) throw new RangeError('The calendar date is outside the supported range.');
  return value;
}

export function addDays(date: Ymd, days: number): Ymd {
  return fromUtcMs(utcMs(date) + Math.trunc(days) * DAY_MS);
}

export function daysBetween(from: Ymd, to: Ymd): number {
  return Math.round((utcMs(to) - utcMs(from)) / DAY_MS);
}

export function isIanaZone(value: string): value is IanaZone {
  if (value.length === 0 || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseZone(value: unknown): IanaZone | null {
  return typeof value === 'string' && isIanaZone(value) ? value : null;
}

const zoneFormatters = new Map<IanaZone, Intl.DateTimeFormat>();

function zoneFormatter(zone: IanaZone): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(zone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  zoneFormatters.set(zone, formatter);
  return formatter;
}

export function todayIn(zone: IanaZone, now: Date): Ymd {
  const parts = zoneFormatter(zone).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return ymdFromParts(read('year'), read('month'), read('day')) ?? fromUtcMs(now.getTime());
}

const weekdayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});
const shortFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function weekdayLabel(date: Ymd): string {
  return weekdayFormat.format(utcMs(date)).toUpperCase();
}

export function longDateLabel(date: Ymd): string {
  return longFormat.format(utcMs(date));
}

export function shortDateLabel(date: Ymd): string {
  return shortFormat.format(utcMs(date));
}

export type DayCell = {
  readonly date: Ymd;
  readonly weekday: string;
  readonly day: number;
  readonly isToday: boolean;
};

export function dayCells(center: Ymd, today: Ymd, radius: number): DayCell[] {
  const cells: DayCell[] = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const date = addDays(center, offset);
    cells.push({
      date,
      weekday: weekdayLabel(date),
      day: Number(date.slice(6, 8)),
      isToday: date === today,
    });
  }
  return cells;
}

export function dayWindow(anchor: Ymd, radius: number): Ymd[] {
  return Array.from({ length: radius * 2 + 1 }, (_, index) => addDays(anchor, index - radius));
}

export function windowIndex(anchor: Ymd, date: Ymd, radius: number): number | null {
  const offset = daysBetween(anchor, date);
  return Math.abs(offset) <= radius ? offset + radius : null;
}

// Native date pickers work in the device's local calendar. Noon never falls in
// a daylight-saving gap, so the round trip keeps the same calendar day.
export function localNoon(date: Ymd): Date {
  return new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    12,
  );
}

export function ymdFromLocalDate(date: Date): Ymd | null {
  return ymdFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}
