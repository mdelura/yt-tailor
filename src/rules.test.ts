import { describe, expect, it } from 'vitest';
import { matchesRule, parsePrefixes, pendingForRule, runRules, summarise } from './rules';
import type { Rule, Video } from './types';

const NOW = Date.parse('2026-11-13T06:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const video = (id: string, title: string, h: number, extra: Partial<Video> = {}): Video => ({
  id,
  title,
  channelId: 'UCx',
  channelTitle: 'Chan',
  date: hoursAgo(h),
  thumb: '',
  durationSec: 600,
  live: 'none',
  stream: false,
  ...extra,
});

const rule = (extra: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  enabled: true,
  channelId: 'UCx',
  channelTitle: 'Chan',
  prefixes: ['Wstawaki', 'Knotki'],
  playlistId: 'PL1',
  playlistTitle: 'Listen2',
  where: 'top',
  since: NOW - 24 * 3_600_000,
  handled: [],
  ...extra,
});

const deps = (inPlaylist: string[] = [], failOn?: string) => {
  const calls: string[] = [];
  return {
    calls,
    isInPlaylist: async (_pl: string, vid: string) => inPlaylist.includes(vid),
    add: async (pl: string, vid: string, where: string) => {
      if (vid === failOn) throw new Error('boom');
      calls.push(`${pl}:${vid}:${where}`);
    },
  };
};

describe('parsePrefixes', () => {
  it('splits, trims and dedupes', () => {
    expect(parsePrefixes(' Wstawaki, Knotki ,,Wstawaki')).toEqual(['Wstawaki', 'Knotki']);
    expect(parsePrefixes('  ')).toEqual([]);
  });
});

describe('matchesRule', () => {
  it('matches title prefixes case-insensitively on the right channel', () => {
    expect(matchesRule(video('a', 'wstawaki #12', 1), rule())).toBe(true);
    expect(matchesRule(video('a', 'Other Wstawaki', 1), rule())).toBe(false);
    expect(matchesRule(video('a', 'Knotki', 1, { channelId: 'UCother' }), rule())).toBe(false);
  });
  it('matches everything when there are no prefixes, but not unfinished streams', () => {
    expect(matchesRule(video('a', 'Anything', 1), rule({ prefixes: [] }))).toBe(true);
    expect(matchesRule(video('a', 'Knotki', 1, { live: 'live' }), rule())).toBe(false);
    expect(matchesRule(video('a', 'Knotki', 1, { live: 'upcoming' }), rule())).toBe(false);
  });
});

describe('pendingForRule', () => {
  it('returns unhandled matches after `since`, oldest first', () => {
    const videos = [
      video('new', 'Knotki 2', 2),
      video('old', 'Wstawaki 1', 20),
      video('tooOld', 'Wstawaki 0', 30),
      video('done', 'Knotki 1', 10),
      video('no', 'Vlog', 3),
    ];
    expect(pendingForRule(rule({ handled: ['done'] }), videos).map((v) => v.id)).toEqual(['old', 'new']);
  });
});

describe('runRules', () => {
  const videos = [video('b', 'Knotki 2', 2), video('a', 'Wstawaki 1', 20), video('x', 'Vlog', 3)];

  it('adds pending videos oldest first and records them as handled', async () => {
    const d = deps();
    const res = await runRules([rule()], videos, d, NOW);
    expect(d.calls).toEqual(['PL1:a:top', 'PL1:b:top']);
    expect(res.added.map((x) => x.video.id)).toEqual(['a', 'b']);
    expect(res.rules[0].handled).toEqual(['a', 'b']);
    expect(res.rules[0].lastRun).toBe(NOW);
    // Second run with the updated rules adds nothing.
    const d2 = deps();
    expect((await runRules(res.rules, videos, d2, NOW)).added).toEqual([]);
    expect(d2.calls).toEqual([]);
  });

  it('skips videos already in the playlist but still marks them handled', async () => {
    const d = deps(['a']);
    const res = await runRules([rule()], videos, d, NOW);
    expect(d.calls).toEqual(['PL1:b:top']);
    expect(res.rules[0].handled).toEqual(['a', 'b']);
  });

  it('ignores disabled rules', async () => {
    const d = deps();
    const res = await runRules([rule({ enabled: false })], videos, d, NOW);
    expect(d.calls).toEqual([]);
    expect(res.rules[0].lastRun).toBeUndefined();
  });

  it('stops at the first failure and keeps earlier progress', async () => {
    const d = deps([], 'b');
    const res = await runRules([rule(), rule({ id: 'r2', playlistId: 'PL2' })], videos, d, NOW);
    expect(res.error).toBeInstanceOf(Error);
    expect(res.rules[0].handled).toEqual(['a']);
    expect(d.calls).toEqual(['PL1:a:top']); // second rule never ran
    expect(res.rules[1].handled).toEqual([]);
  });

  it('respects the per-run cap and reports what is left', async () => {
    const d = deps();
    const res = await runRules([rule()], videos, d, NOW, 1);
    expect(d.calls).toEqual(['PL1:a:top']);
    expect(res.remaining).toBe(1);
    expect(res.rules[0].handled).toEqual(['a']);
  });
});

describe('summarise', () => {
  it('groups by playlist', () => {
    const r = rule();
    const other = rule({ playlistTitle: 'Queue' });
    const v = video('a', 'Knotki', 1);
    expect(summarise([{ rule: r, video: v }, { rule: r, video: v }, { rule: other, video: v }])).toBe(
      '2 videos to Listen2, 1 video to Queue',
    );
  });
});
