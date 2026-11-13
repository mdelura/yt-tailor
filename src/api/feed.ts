import type { Channel, LiveState, Video } from '../types';
import { ApiError, yt, ytAll, type Page } from './client';

export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // API policy: do not keep data longer than 30 days
const VIDEOS_PER_CHANNEL = 10;
const STREAMS_PER_CHANNEL = 5;
const CONCURRENCY = 6;

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
async function playlistVideoIds(prefix: string, channelId: string, max: number): Promise<string[]> {
  try {
    const page = await yt<Page<any>>('playlistItems', {
      part: 'contentDetails',
      playlistId: prefix + channelId.slice(2),
      maxResults: max,
    });
    return (page.items ?? []).map((it) => it.contentDetails.videoId as string);
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

/** Recent long-form videos and live streams for the given channels. Costs about 2 units per channel. */
export async function fetchChannelVideos(
  channels: Channel[],
  onProgress?: (done: number, total: number) => void,
): Promise<Video[]> {
  let done = 0;
  const streamIds = new Set<string>();
  const perChannel = await mapPool(channels, CONCURRENCY, async (c) => {
    const [videos, streams] = await Promise.all([
      playlistVideoIds('UULF', c.id, VIDEOS_PER_CHANNEL),
      playlistVideoIds('UULV', c.id, STREAMS_PER_CHANNEL),
    ]);
    for (const id of streams) streamIds.add(id);
    onProgress?.(++done, channels.length);
    return [...videos, ...streams];
  });

  const ids = [...new Set(perChannel.flat())];
  const pages = await mapPool(chunk(ids, 50), CONCURRENCY, (batch) =>
    yt<Page<any>>('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails',
      id: batch.join(','),
      maxResults: 50,
    }),
  );
  return pages.flatMap((p) => p.items ?? []).map((it) => toVideo(it, streamIds));
}
