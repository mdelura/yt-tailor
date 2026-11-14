import { describe, expect, it } from 'vitest';
import type { Channel, Video } from '../types';
import { chunk, favouriteGroups, keepSubscribed, mapPool, mergeVideos, parseDuration } from './feed';
import { byRecentUse, insertBody } from './playlists';
import { addQuota, getQuota, pacificDay } from './quota';
import { parseSettings } from '../store/settings';
import { fmtAge, fmtDuration } from '../format';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const video = (id: string, channelId: string, h: number, extra: Partial<Video> = {}): Video => ({
  id,
  title: id,
  channelId,
  channelTitle: channelId,
  date: hoursAgo(h),
  thumb: '',
  durationSec: 600,
  live: 'none',
  stream: false,
  ...extra,
});
const channel = (id: string): Channel => ({ id, title: id, thumb: '' });

describe('parseDuration', () => {
  it('parses ISO 8601 durations', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT45S')).toBe(45);
    expect(parseDuration('PT10M')).toBe(600);
    expect(parseDuration('P1DT1H')).toBe(90000);
  });
  it('returns 0 for missing or live placeholders', () => {
    expect(parseDuration(undefined)).toBe(0);
    expect(parseDuration('P0D')).toBe(0);
    expect(parseDuration('nonsense')).toBe(0);
  });
});

describe('mergeVideos', () => {
  it('dedupes by id with incoming winning, sorts newest first', () => {
    const merged = mergeVideos(
      [video('a', 'c1', 5), video('b', 'c1', 1)],
      [video('a', 'c1', 5, { title: 'renamed' }), video('c', 'c2', 3)],
      NOW,
    );
    expect(merged.map((v) => v.id)).toEqual(['b', 'c', 'a']);
    expect(merged[2].title).toBe('renamed');
  });
  it('drops videos older than 30 days', () => {
    const merged = mergeVideos([video('old', 'c1', 31 * 24)], [video('new', 'c1', 29 * 24)], NOW);
    expect(merged.map((v) => v.id)).toEqual(['new']);
  });
});

describe('keepSubscribed', () => {
  it('removes videos of unsubscribed channels', () => {
    const kept = keepSubscribed([video('a', 'c1', 1), video('b', 'gone', 2)], [channel('c1')]);
    expect(kept.map((v) => v.id)).toEqual(['a']);
  });
});

describe('favouriteGroups', () => {
  const videos = mergeVideos(
    [],
    [
      video('a1', 'A', 10), video('a2', 'A', 20), video('a3', 'A', 30), video('a4', 'A', 40),
      video('b1', 'B', 2), video('b2', 'B', 50),
      video('c1', 'C', 1),
    ],
    NOW,
  );
  const channels = [channel('A'), channel('B'), channel('C'), channel('D')];

  it('takes the last N per favourite channel, newest channel first', () => {
    const groups = favouriteGroups(videos, channels, ['A', 'B'], 3);
    expect(groups.map((g) => g.channel.id)).toEqual(['B', 'A']);
    expect(groups[1].videos.map((v) => v.id)).toEqual(['a1', 'a2', 'a3']);
    expect(groups[0].videos.map((v) => v.id)).toEqual(['b1', 'b2']);
  });
  it('skips favourites with no videos or no longer subscribed', () => {
    expect(favouriteGroups(videos, channels, ['D', 'gone'], 3)).toEqual([]);
  });
});

describe('mapPool / chunk', () => {
  it('keeps order and respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('insertBody', () => {
  it('sets position 0 for top and omits it for bottom', () => {
    expect(insertBody('PL1', 'vid', 'top').snippet).toMatchObject({ playlistId: 'PL1', position: 0 });
    expect('position' in insertBody('PL1', 'vid', 'bottom').snippet).toBe(false);
    expect(insertBody('PL1', 'vid', 'bottom').snippet.resourceId).toEqual({ kind: 'youtube#video', videoId: 'vid' });
  });
});

describe('quota', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('accumulates within a Pacific day and resets on the next', () => {
    const store = memory();
    const day1 = new Date('2026-11-12T20:00:00Z'); // noon PT
    addQuota(1, store, day1);
    expect(addQuota(50, store, day1)).toBe(51);
    // 06:00 UTC next day is still the same Pacific day (22:00 PT)
    expect(getQuota(store, new Date('2026-11-13T06:00:00Z'))).toBe(51);
    expect(getQuota(store, new Date('2026-11-13T09:00:00Z'))).toBe(0);
  });
  it('formats the Pacific date', () => {
    expect(pacificDay(new Date('2026-11-13T06:00:00Z'))).toBe('2026-11-12');
  });
});

describe('parseSettings', () => {
  it('falls back to defaults on bad input', () => {
    const defaults = { favourites: [], perChannel: 3, playlistUsed: {}, rules: [], updatedAt: 0 };
    expect(parseSettings(null)).toEqual(defaults);
    expect(parseSettings('{bad')).toEqual(defaults);
  });
  it('sanitises values', () => {
    const s = parseSettings(
      JSON.stringify({ favourites: ['a', 'a', 5], perChannel: 99, playlistUsed: { PL: 7, bad: 'x', neg: -1 } }),
    );
    expect(s).toEqual({ favourites: ['a'], perChannel: 10, playlistUsed: { PL: 7 }, rules: [], updatedAt: 0 });
  });
  it('carries over the last used playlist from older settings', () => {
    expect(parseSettings(JSON.stringify({ lastPlaylist: 'PL' })).playlistUsed).toEqual({ PL: 1 });
    expect(parseSettings(JSON.stringify({ lastPlaylist: 'PL', playlistUsed: { PL: 9 } })).playlistUsed).toEqual({ PL: 9 });
  });
});

describe('byRecentUse', () => {
  it('puts recently used playlists first and leaves the rest in their original order', () => {
    const pl = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, count: 0 }));
    expect(byRecentUse(pl, { c: 10, d: 20 }).map((p) => p.id)).toEqual(['d', 'c', 'a', 'b']);
    expect(byRecentUse(pl, {}).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(fmtDuration(0)).toBe('');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(3723)).toBe('1:02:03');
  });
  it('formats ages', () => {
    expect(fmtAge(hoursAgo(0), NOW)).toBe('just now');
    expect(fmtAge(hoursAgo(5), NOW)).toBe('5 h ago');
    expect(fmtAge(hoursAgo(30), NOW)).toBe('yesterday');
    expect(fmtAge(hoursAgo(24 * 15), NOW)).toBe('2 weeks ago');
  });
});
