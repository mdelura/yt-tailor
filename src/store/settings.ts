import type { Rule, Settings, WatchLater } from '../types';

const KEY = 'tailor.settings';
export const DEFAULTS: Settings = { favourites: [], perChannel: 3, rules: [], updatedAt: 0 };

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === 'string'))] : [];

function parseRule(r: any): Rule | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || typeof r.channelId !== 'string' || typeof r.playlistId !== 'string') return null;
  return {
    id: r.id,
    enabled: r.enabled !== false,
    channelId: r.channelId,
    channelTitle: typeof r.channelTitle === 'string' ? r.channelTitle : r.channelId,
    prefixes: strings(r.prefixes),
    playlistId: r.playlistId,
    playlistTitle: typeof r.playlistTitle === 'string' ? r.playlistTitle : r.playlistId,
    where: r.where === 'bottom' ? 'bottom' : 'top',
    since: Number.isFinite(r.since) ? r.since : Date.now(),
    handled: strings(r.handled),
    lastRun: Number.isFinite(r.lastRun) ? r.lastRun : undefined,
  };
}

function parseWatchLater(w: any): WatchLater | undefined {
  if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id) return undefined;
  return {
    id: w.id,
    title: typeof w.title === 'string' ? w.title : w.id,
    where: w.where === 'bottom' ? 'bottom' : 'top',
  };
}

/** Validates untrusted JSON (localStorage or an imported file) into Settings. */
export function parseSettings(json: string | null): Settings {
  try {
    const v = JSON.parse(json ?? 'null');
    if (!v || typeof v !== 'object') return { ...DEFAULTS };
    const n = Math.round(Number(v.perChannel));
    return {
      favourites: strings(v.favourites),
      perChannel: Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : DEFAULTS.perChannel,
      lastPlaylist: typeof v.lastPlaylist === 'string' ? v.lastPlaylist : undefined,
      watchLater: parseWatchLater(v.watchLater),
      rules: Array.isArray(v.rules) ? v.rules.map(parseRule).filter((r: Rule | null): r is Rule => r !== null) : [],
      updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadSettings(): Settings {
  const s = parseSettings(localStorage.getItem(KEY));
  // Settings saved before sync existed carry no timestamp. Give them the oldest possible one,
  // so they are uploaded on first sync but never beat a copy that was really edited later.
  if (s.updatedAt === 0 && (s.favourites.length > 0 || s.rules.length > 0)) s.updatedAt = 1;
  return s;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
