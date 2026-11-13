// Local estimate of YouTube Data API quota spent today.
// The real quota resets at midnight Pacific Time, so the counter is keyed by the Pacific date.

export const DAILY_QUOTA = 10_000;
const KEY = 'tailor.quota';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function pacificDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function getQuota(store: Store = localStorage, now: Date = new Date()): number {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? 'null');
    return v && v.day === pacificDay(now) ? Number(v.used) || 0 : 0;
  } catch {
    return 0;
  }
}

export function addQuota(units: number, store: Store = localStorage, now: Date = new Date()): number {
  const used = getQuota(store, now) + units;
  store.setItem(KEY, JSON.stringify({ day: pacificDay(now), used }));
  return used;
}
