// Settings sync between devices. The newer copy wins as a whole; rule bookkeeping is unioned
// so a video one device already handled is never added again by another.
import { parseSettings } from './store/settings';
import type { Rule, Settings } from './types';

const HANDLED_CAP = 500;

/** Same shape and key order for any Settings object, so copies can be compared as strings. */
export const canonical = (s: Settings): string => JSON.stringify(parseSettings(JSON.stringify(s)));

export function mergeSettings(local: Settings, remote: Settings | null): Settings {
  if (!remote) return local;
  const [winner, loser] = remote.updatedAt > local.updatedAt ? [remote, local] : [local, remote];
  const other = new Map(loser.rules.map((r) => [r.id, r]));
  const rules: Rule[] = winner.rules.map((r) => {
    const o = other.get(r.id);
    if (!o) return r;
    const lastRun = Math.max(r.lastRun ?? 0, o.lastRun ?? 0) || undefined;
    return { ...r, handled: [...new Set([...o.handled, ...r.handled])].slice(-HANDLED_CAP), lastRun };
  });
  return { ...winner, rules };
}

export interface SyncIo {
  readRemote(): Promise<{ id: string | null; json: string | null }>;
  writeRemote(id: string | null, json: string): Promise<string>;
}

export interface SyncResult {
  settings: Settings;
  /** The local copy should be replaced with `settings`. */
  pulled: boolean;
  /** The Drive copy was updated. */
  pushed: boolean;
}

export async function syncSettings(local: Settings, io: SyncIo): Promise<SyncResult> {
  const remote = await io.readRemote();
  const remoteSettings = remote.json ? parseSettings(remote.json) : null;
  const merged = mergeSettings(local, remoteSettings);
  const mergedJson = canonical(merged);
  const pulled = mergedJson !== canonical(local);
  // Nothing worth saving yet: brand-new device and nothing in Drive.
  const empty = !remoteSettings && merged.updatedAt === 0;
  const pushed = !empty && (!remoteSettings || mergedJson !== canonical(remoteSettings));
  if (pushed) await io.writeRemote(remote.id, mergedJson);
  return { settings: merged, pulled, pushed };
}
