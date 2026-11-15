import type { Playlist } from '../types';
import { yt, ytAll, type Page } from './client';

export type Where = 'top' | 'bottom';

export async function fetchPlaylists(): Promise<Playlist[]> {
  const items = await ytAll<any>('playlists', {
    part: 'snippet,contentDetails',
    mine: 'true',
    maxResults: 50,
  });
  return items.map((it) => ({
    id: it.id as string,
    title: it.snippet.title as string,
    count: Number(it.contentDetails?.itemCount ?? 0),
  }));
}

/** Most recently used in YTailor first; playlists never used keep YouTube's order after them. */
export function byRecentUse(playlists: Playlist[], used: Record<string, number>): Playlist[] {
  return [...playlists].sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0));
}

/** Request body for playlistItems.insert. Position 0 puts the video first; omitted appends. */
export function insertBody(playlistId: string, videoId: string, where: Where) {
  return {
    snippet: {
      playlistId,
      resourceId: { kind: 'youtube#video', videoId },
      ...(where === 'top' ? { position: 0 } : {}),
    },
  };
}

/** 1 quota unit. The playlist entry id of the video, or null when it is not in the playlist. */
export async function findInPlaylist(playlistId: string, videoId: string): Promise<string | null> {
  const page = await yt<Page<{ id: string }>>('playlistItems', { part: 'id', playlistId, videoId, maxResults: 1 });
  return page.items?.[0]?.id ?? null;
}

/** 1 quota unit. Used by rules so a video already in the playlist is not added again. */
export async function isInPlaylist(playlistId: string, videoId: string): Promise<boolean> {
  return (await findInPlaylist(playlistId, videoId)) !== null;
}

/** 50 quota units. `itemId` is the playlist entry id, not the video id. */
export async function removeFromPlaylist(itemId: string): Promise<void> {
  await yt('playlistItems', { id: itemId }, { method: 'DELETE', cost: 50 });
}

export async function addToPlaylist(playlistId: string, videoId: string, where: Where): Promise<void> {
  await yt('playlistItems', { part: 'snippet' }, {
    method: 'POST',
    body: insertBody(playlistId, videoId, where),
    cost: 50,
  });
}
