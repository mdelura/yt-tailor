export interface Channel {
  id: string;
  title: string;
  thumb: string;
}

export type LiveState = 'none' | 'live' | 'upcoming';

export interface Video {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  /** ISO date used for ordering: stream start for live videos, otherwise publish time. */
  date: string;
  thumb: string;
  durationSec: number;
  live: LiveState;
  /** True when the video came from the channel's live-streams playlist. */
  stream: boolean;
}

export interface Playlist {
  id: string;
  title: string;
  count: number;
}

/** "New videos from this channel whose title starts with one of these go to that playlist." */
export interface Rule {
  id: string;
  enabled: boolean;
  channelId: string;
  channelTitle: string;
  /** Title prefixes, matched case-insensitively. Empty means every video of the channel. */
  prefixes: string[];
  playlistId: string;
  playlistTitle: string;
  where: 'top' | 'bottom';
  /** Only videos published after this time (ms) are considered. */
  since: number;
  /** Video ids this rule has already dealt with, so nothing is added twice. */
  handled: string[];
  lastRun?: number;
}

export interface Settings {
  favourites: string[];
  perChannel: number;
  lastPlaylist?: string;
  rules: Rule[];
  /** When these settings were last changed (ms); decides which copy wins when syncing. 0 = never. */
  updatedAt: number;
}
