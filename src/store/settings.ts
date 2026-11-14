import type { Rule, Settings } from '../types';

const KEY = 'tailor.settings';
export const DEFAULTS: Settings = { favourites: [], perChannel: 3, playlistUsed: {}, rules: [], updatedAt: 0 };
const PLAYLIST_USED_CAP = 100;

/** Most recent first and capped, so deleted playlists age out and equal copies serialise the same. */
export function tidyPlaylistUsed(used: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(used)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, PLAYLIST_USED_CAP),
  );
}

function parsePlaylistUsed(v: any): Record<string, number> {
  const used: Record<string, number> = {};
  if (v.playlistUsed && typeof v.playlistUsed === 'object' && !Array.isArray(v.playlistUsed)) {
    for (const [id, at] of Object.entries(v.playlistUsed)) {
      if (typeof at === 'number' && Number.isFinite(at) && at > 0) used[id] = at;
    }
  }
  // Settings saved before per-playlist times existed only remembered the last playlist added to.
  if (typeof v.lastPlaylist === 'string' && !(v.lastPlaylist in used)) used[v.lastPlaylist] = 1;
  return tidyPlaylistUsed(used);
}

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

/** Validates untrusted JSON (localStorage or an imported file) into Settings. */
export function parseSettings(json: string | null): Settings {
  try {
    const v = JSON.parse(json ?? 'null');
    if (!v || typeof v !== 'object') return { ...DEFAULTS };
    const n = Math.round(Number(v.perChannel));
    return {
      favourites: strings(v.favourites),
      perChannel: Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : DEFAULTS.perChannel,
      playlistUsed: parsePlaylistUsed(v),
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
