import { describe, expect, it } from 'vitest';
import { canonical, mergeSettings, syncSettings } from './sync';
import type { Rule, Settings } from './types';

const rule = (id: string, extra: Partial<Rule> = {}): Rule => ({
  id,
  enabled: true,
  channelId: 'UCx',
  channelTitle: 'Chan',
  prefixes: ['Knotki'],
  playlistId: 'PL1',
  playlistTitle: 'Listen2',
  where: 'top',
  since: 1000,
  handled: [],
  ...extra,
});

const settings = (extra: Partial<Settings> = {}): Settings => ({
  favourites: [],
  perChannel: 3,
  rules: [],
  updatedAt: 0,
  ...extra,
});

const io = (json: string | null) => {
  const state = { id: json ? 'file1' : (null as string | null), json, writes: 0 };
  return {
    state,
    readRemote: async () => ({ id: state.id, json: state.json }),
    writeRemote: async (id: string | null, body: string) => {
      state.writes++;
      state.json = body;
      state.id = id ?? 'new';
      return state.id;
    },
  };
};

describe('mergeSettings', () => {
  it('takes the newer copy as a whole', () => {
    const local = settings({ favourites: ['a'], updatedAt: 10 });
    const remote = settings({ favourites: ['b'], perChannel: 5, updatedAt: 20 });
    expect(mergeSettings(local, remote)).toMatchObject({ favourites: ['b'], perChannel: 5, updatedAt: 20 });
    expect(mergeSettings(remote, local)).toMatchObject({ favourites: ['b'], updatedAt: 20 });
    expect(mergeSettings(local, null)).toBe(local);
  });

  it('unions handled videos and keeps the latest run for shared rules', () => {
    const local = settings({ updatedAt: 20, rules: [rule('r1', { handled: ['a', 'b'], lastRun: 5 }), rule('r2')] });
    const remote = settings({ updatedAt: 10, rules: [rule('r1', { handled: ['b', 'c'], lastRun: 9 }), rule('gone')] });
    const merged = mergeSettings(local, remote);
    expect(merged.rules.map((r) => r.id)).toEqual(['r1', 'r2']); // winner's rule list
    expect(merged.rules[0].handled.sort()).toEqual(['a', 'b', 'c']);
    expect(merged.rules[0].lastRun).toBe(9);
  });
});

describe('syncSettings', () => {
  it('does nothing for a fresh device with an empty Drive', async () => {
    const d = io(null);
    const res = await syncSettings(settings(), d);
    expect(res).toMatchObject({ pulled: false, pushed: false });
    expect(d.state.writes).toBe(0);
  });

  it('uploads local settings when Drive is empty', async () => {
    const d = io(null);
    const local = settings({ favourites: ['a'], updatedAt: 5 });
    const res = await syncSettings(local, d);
    expect(res).toMatchObject({ pulled: false, pushed: true });
    expect(d.state.json).toBe(canonical(local));
  });

  it('adopts a newer Drive copy without writing back', async () => {
    const remote = settings({ favourites: ['b'], updatedAt: 9 });
    const d = io(JSON.stringify(remote));
    const res = await syncSettings(settings(), d);
    expect(res.pulled).toBe(true);
    expect(res.pushed).toBe(false);
    expect(res.settings.favourites).toEqual(['b']);
  });

  it('pushes when local is newer, and is a no-op when both match', async () => {
    const d = io(JSON.stringify(settings({ favourites: ['old'], updatedAt: 1 })));
    const local = settings({ favourites: ['new'], updatedAt: 2 });
    expect(await syncSettings(local, d)).toMatchObject({ pulled: false, pushed: true });
    expect(await syncSettings(local, d)).toMatchObject({ pulled: false, pushed: false });
    expect(d.state.writes).toBe(1);
  });

  it('does both when a newer Drive copy lacks locally handled videos', async () => {
    const d = io(JSON.stringify(settings({ updatedAt: 9, rules: [rule('r1', { handled: ['x'] })] })));
    const local = settings({ updatedAt: 3, rules: [rule('r1', { handled: ['y'] })] });
    const res = await syncSettings(local, d);
    expect(res).toMatchObject({ pulled: true, pushed: true });
    expect(res.settings.rules[0].handled.sort()).toEqual(['x', 'y']);
  });
});
