// Sample data for `?demo`: lets you try the layout before the Google Cloud setup. No API calls.
import type { Channel, Playlist, Video } from './types';

export const IS_DEMO = new URLSearchParams(location.search).has('demo');

const NAMES = [
  'Quiet Workshop', 'Orbit Notes', 'Slow Kitchen', 'Trail Diaries', 'Pixel Bench', 'Deep Field',
  'Small Engines', 'Paper Maps', 'Night Signals', 'Loom & Lathe', 'Tide Tables', 'Second Draft',
];
const TOPICS = [
  'Restoring a 1970s lathe from scratch', 'What nobody tells you about sourdough hydration',
  'Three days alone on the ridge trail', 'Building a keyboard that lasts twenty years',
  'Why this telescope mount changed everything', 'A calm walkthrough of the new release',
  'Fixing the mistake I made last month', 'The cheapest upgrade that actually matters',
  'Live Q&A: your questions answered', 'Field test in the worst weather of the year',
];

export function demoChannels(): Channel[] {
  return NAMES.map((title, i) => ({ id: `UCdemo${String(i).padStart(2, '0')}`, title, thumb: '' }));
}

export function demoVideos(now: number = Date.now()): Video[] {
  const out: Video[] = [];
  demoChannels().forEach((c, ci) => {
    for (let k = 0; k < 6; k++) {
      const n = ci * 6 + k;
      const stream = n % 11 === 3;
      out.push({
        id: `demo${n}`,
        title: TOPICS[(ci + k * 3) % TOPICS.length],
        channelId: c.id,
        channelTitle: c.title,
        date: new Date(now - (k * 53 + ci * 7 + 1) * 3_600_000).toISOString(),
        thumb: '',
        durationSec: stream && k === 0 ? 0 : 240 + ((n * 137) % 3200),
        live: stream && k === 0 ? 'live' : 'none',
        stream,
      });
    }
  });
  return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function demoPlaylists(): Playlist[] {
  return [
    { id: 'PLdemo1', title: 'Queue', count: 14 },
    { id: 'PLdemo2', title: 'Weekend long watches', count: 6 },
    { id: 'PLdemo3', title: 'Reference', count: 31 },
  ];
}
