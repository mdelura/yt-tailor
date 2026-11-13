// Playlist rules: run in the browser after a feed refresh (or on demand), using the feed already loaded.
import type { Rule, Video } from './types';

const HANDLED_CAP = 500;
/** Safety cap per run: each add costs 50 quota units. */
export const MAX_ADDS_PER_RUN = 20;
/** A new rule looks back this far, so the first run picks up the last day. */
export const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export function parsePrefixes(text: string): string[] {
  return [...new Set(text.split(',').map((p) => p.trim()).filter(Boolean))];
}

export function matchesRule(v: Video, rule: Rule): boolean {
  if (v.channelId !== rule.channelId) return false;
  // Streams that are scheduled or still running are picked up once they have finished.
  if (v.live !== 'none') return false;
  if (rule.prefixes.length === 0) return true;
  const title = v.title.trim().toLowerCase();
  return rule.prefixes.some((p) => title.startsWith(p.trim().toLowerCase()));
}

/**
 * Videos the rule still has to add, oldest first. Adding in that order leaves the newest
 * on top for "top" rules and keeps chronological order for "bottom" rules.
 */
export function pendingForRule(rule: Rule, videos: Video[]): Video[] {
  const handled = new Set(rule.handled);
  return videos
    .filter((v) => matchesRule(v, rule) && Date.parse(v.date) > rule.since && !handled.has(v.id))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export interface RuleDeps {
  isInPlaylist(playlistId: string, videoId: string): Promise<boolean>;
  add(playlistId: string, videoId: string, where: 'top' | 'bottom'): Promise<void>;
}

export interface RuleRunResult {
  /** Rules with updated `handled` / `lastRun`. */
  rules: Rule[];
  added: { rule: Rule; video: Video }[];
  /** Matches left for the next run because the per-run cap was reached. */
  remaining: number;
  /** First failure; the run stops there and keeps what was done so far. */
  error?: unknown;
}

export async function runRules(
  rules: Rule[],
  videos: Video[],
  deps: RuleDeps,
  now: number = Date.now(),
  maxAdds: number = MAX_ADDS_PER_RUN,
): Promise<RuleRunResult> {
  const result: RuleRunResult = { rules: [], added: [], remaining: 0 };
  for (const rule of rules) {
    if (!rule.enabled || result.error) {
      result.rules.push(rule);
      continue;
    }
    const handled = [...rule.handled];
    for (const video of pendingForRule(rule, videos)) {
      if (result.added.length >= maxAdds) {
        result.remaining++;
        continue;
      }
      try {
        if (!(await deps.isInPlaylist(rule.playlistId, video.id))) {
          await deps.add(rule.playlistId, video.id, rule.where);
          result.added.push({ rule, video });
        }
        handled.push(video.id);
      } catch (e) {
        result.error = e;
        break;
      }
    }
    result.rules.push({ ...rule, handled: handled.slice(-HANDLED_CAP), lastRun: now });
  }
  return result;
}

/** "2 videos to Listen2, 1 video to Queue" */
export function summarise(added: RuleRunResult['added']): string {
  const counts = new Map<string, number>();
  for (const { rule } of added) counts.set(rule.playlistTitle, (counts.get(rule.playlistTitle) ?? 0) + 1);
  return [...counts].map(([title, n]) => `${n} video${n === 1 ? '' : 's'} to ${title}`).join(', ');
}
