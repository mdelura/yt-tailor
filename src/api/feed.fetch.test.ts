import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, Video } from '../types';

const calls: { path: string; params: Record<string, any> }[] = [];

// Each channel's UULF playlist holds 30 videos `<channel>-<n>`; UULV is empty.
vi.mock('./client', () => ({
  ApiError: class extends Error {},
  ytAll: vi.fn(),
  yt: vi.fn(async (path: string, params: Record<string, any>) => {
    calls.push({ path, params });
    if (path === 'playlistItems') {
      if (params.playlistId.startsWith('UULV')) return { items: [] };
      const ch = 'UC' + params.playlistId.slice(4);
      const items = Array.from({ length: 30 }, (_, n) => ({
        contentDetails: { videoId: `${ch}-${n}`, videoPublishedAt: new Date().toISOString() },
      }));
      return { items: items.slice(0, params.maxResults) };
    }
    return {
      items: params.id.split(',').map((id: string) => ({
        id,
        snippet: { title: id, channelId: id.split('-')[0], channelTitle: '', publishedAt: new Date().toISOString(), liveBroadcastContent: 'none' },
        contentDetails: { duration: 'PT10M' },
      })),
    };
  }),
}));

const { fetchChannelVideos } = await import('./feed');

const channel = (id: string): Channel => ({ id, title: id, thumb: '' });
const channels = ['UCa', 'UCb', 'UCc', 'UCd', 'UCe', 'UCf', 'UCg'].map(channel);

beforeEach(() => {
  calls.length = 0;
});

describe('fetchChannelVideos', () => {
  it('streams batches of at most 50 videos', async () => {
    const batches: Video[][] = [];
    await fetchChannelVideos(channels, new Map(), (b) => batches.push(b));
    expect(batches.every((b) => b.length <= 50)).toBe(true);
    expect(new Set(batches.flat().map((v) => v.id)).size).toBe(70);
    expect(batches.length).toBe(2); // 70 ids → 50 + 20
  });

  it('skips videos already cached', async () => {
    const known = new Map<string, Video>();
    for (const c of channels) {
      for (let n = 0; n < 10; n++) known.set(`${c.id}-${n}`, { id: `${c.id}-${n}`, live: 'none' } as Video);
    }
    const batches: Video[][] = [];
    await fetchChannelVideos(channels, known, (b) => batches.push(b));
    expect(batches).toEqual([]);
    expect(calls.filter((c) => c.path === 'videos')).toHaveLength(0);
  });
});
