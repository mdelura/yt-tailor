import type { Channel, LiveState, Video } from '../types';
import { ApiError, yt, ytAll, type Page } from './client';

export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // API policy: do not keep data longer than 30 days
const VIDEOS_PER_CHANNEL = 10;
const STREAMS_PER_CHANNEL = 5;
// googleapis.com speaks HTTP/2, so the browser's 6-connections-per-host limit does not apply.
// Each channel makes two playlist calls at once, so this is about 40 requests in flight.
const CONCURRENCY = 20;
/** videos.list accepts at most 50 ids per call. */
const DETAILS_BATCH = 50;

// ---------- pure helpers (unit tested) ----------

/** ISO 8601 duration (PT1H2M3S, P1DT2H) to seconds. */
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

/** Merges fresh videos over cached ones, drops entries older than 30 days, newest first. */
export function mergeVideos(existing: Video[], incoming: Video[], now: number = Date.now()): Video[] {
  const byId = new Map<string, Video>();
  for (const v of existing) byId.set(v.id, v);
  for (const v of incoming) byId.set(v.id, v);
  return [...byId.values()]
    .filter((v) => now - Date.parse(v.date) <= MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** Drops videos from channels the user is no longer subscribed to. */
export function keepSubscribed(videos: Video[], channels: Channel[]): Video[] {
  const ids = new Set(channels.map((c) => c.id));
  return videos.filter((v) => ids.has(v.channelId));
}

export interface FavouriteGroup {
  channel: Channel;
  videos: Video[];
}

/** Last `perChannel` videos of each favourite channel; channel with the newest video first. */
export function favouriteGroups(
  videos: Video[],
  channels: Channel[],
  favourites: string[],
  perChannel: number,
): FavouriteGroup[] {
  const favs = new Set(favourites);
  const groups = new Map<string, FavouriteGroup>();
  for (const c of channels) if (favs.has(c.id)) groups.set(c.id, { channel: c, videos: [] });
  // `videos` is already newest first.
  for (const v of videos) {
    const g = groups.get(v.channelId);
    if (g && g.videos.length < perChannel) g.videos.push(v);
  }
  return [...groups.values()]
    .filter((g) => g.videos.length > 0)
    .sort((a, b) => Date.parse(b.videos[0].date) - Date.parse(a.videos[0].date));
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PlaylistEntry {
  id: string;
  /** contentDetails.videoPublishedAt; missing for private or deleted videos. */
  publishedAt?: string;
}

/**
 * Whether a playlist entry needs a videos.list call: it is new, or cached but still live or upcoming.
 * New uploads older than the 30-day window are skipped since the merge would drop them anyway.
 * Streams are never skipped by age: their feed date is the stream start, not the publish time.
 */
export function needsDetails(
  entry: PlaylistEntry,
  known: ReadonlyMap<string, Video>,
  isStream: boolean,
  now: number = Date.now(),
): boolean {
  const cached = known.get(entry.id);
  if (cached) return cached.live !== 'none';
  if (!isStream && entry.publishedAt && now - Date.parse(entry.publishedAt) > MAX_AGE_MS) return false;
  return true;
}

// ---------- API calls ----------

export async function fetchSubscriptions(): Promise<Channel[]> {
  const items = await ytAll<any>('subscriptions', {
    part: 'snippet',
    mine: 'true',
    maxResults: 50,
    order: 'alphabetical',
  });
  return items.map((it) => ({
    id: it.snippet.resourceId.channelId as string,
    title: it.snippet.title as string,
    thumb: (it.snippet.thumbnails?.default?.url as string) ?? '',
  }));
}

/**
 * Video ids from one of a channel's auto-generated playlists.
 * Prefix UULF = long-form uploads (no Shorts), UULV = live streams. A channel with none returns 404.
 */
async function playlistEntries(prefix: string, channelId: string, max: number): Promise<PlaylistEntry[]> {
  try {
    const page = await yt<Page<any>>('playlistItems', {
      part: 'contentDetails',
      playlistId: prefix + channelId.slice(2),
      maxResults: max,
    });
    return (page.items ?? []).map((it) => ({
      id: it.contentDetails.videoId as string,
      publishedAt: it.contentDetails.videoPublishedAt as string | undefined,
    }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
}

function toVideo(it: any, streamIds: Set<string>): Video {
  const lbc = it.snippet.liveBroadcastContent;
  const live: LiveState = lbc === 'live' ? 'live' : lbc === 'upcoming' ? 'upcoming' : 'none';
  const t = it.snippet.thumbnails ?? {};
  return {
    id: it.id,
    title: it.snippet.title,
    channelId: it.snippet.channelId,
    channelTitle: it.snippet.channelTitle,
    date: it.liveStreamingDetails?.actualStartTime ?? it.snippet.publishedAt,
    thumb: (t.medium ?? t.high ?? t.default)?.url ?? '',
    durationSec: parseDuration(it.contentDetails?.duration),
    live,
    stream: streamIds.has(it.id),
  };
}

/**
 * Recent long-form videos and live streams for the given channels, handed to `onVideos` in batches
 * as soon as each videos.list call returns, so the feed can fill in while channels are still loading.
 * Only videos missing from `known` (or still live/upcoming there) are looked up.
 * Costs 2 units per channel plus 1 per 50 videos looked up.
 */
export async function fetchChannelVideos(
  channels: Channel[],
  known: ReadonlyMap<string, Video>,
  onVideos: (videos: Video[]) => void,
  onProgress?: () => void,
): Promise<void> {
  const pending = new Map<string, boolean>(); // video id → came from the live-streams playlist
  const inFlight: Promise<void>[] = [];

  const lookUp = (batch: [string, boolean][]) => {
    const streamIds = new Set(batch.filter(([, s]) => s).map(([id]) => id));
    const p = yt<Page<any>>('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails',
      id: batch.map(([id]) => id).join(','),
      maxResults: DETAILS_BATCH,
    }).then((page) => onVideos((page.items ?? []).map((it) => toVideo(it, streamIds))));
    // Marks the promise handled so a failure waits for the Promise.all below instead of
    // surfacing as an unhandled rejection while channels are still loading.
    p.catch(() => {});
    inFlight.push(p);
  };
  const flush = (all: boolean) => {
    while (pending.size >= DETAILS_BATCH || (all && pending.size > 0)) {
      const batch = [...pending].slice(0, DETAILS_BATCH);
      for (const [id] of batch) pending.delete(id);
      lookUp(batch);
    }
  };

  await mapPool(channels, CONCURRENCY, async (c) => {
    const [videos, streams] = await Promise.all([
      playlistEntries('UULF', c.id, VIDEOS_PER_CHANNEL),
      playlistEntries('UULV', c.id, STREAMS_PER_CHANNEL),
    ]);
    const now = Date.now();
    for (const e of videos) {
      if (needsDetails(e, known, false, now) && !pending.has(e.id)) pending.set(e.id, false);
    }
    for (const e of streams) if (needsDetails(e, known, true, now)) pending.set(e.id, true);
    onProgress?.();
    flush(false);
  });
  flush(true);
  await Promise.all(inFlight);
}
