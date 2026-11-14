import { fmtAge, fmtDuration } from '../format';
import type { Video } from '../types';

interface Props {
  video: Video;
  /** Hide the channel name (used inside a favourite channel's own row). */
  compact?: boolean;
  onAdd: (v: Video) => void;
  /** Name of the playlist standing in for Watch Later, once one is chosen. */
  laterTitle?: string;
  laterState?: LaterState;
  onLater: (v: Video) => void;
}

export type LaterState = 'busy' | 'done';

function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function VideoCard({ video: v, compact, onAdd, laterTitle, laterState, onLater }: Props) {
  const laterLabel = `${laterState === 'done' ? 'Saved' : 'Save'} to ${laterTitle ?? 'Watch Later'}`;
  const badge =
    v.live === 'live' ? 'LIVE' : v.live === 'upcoming' ? 'Upcoming' : fmtDuration(v.durationSec);
  return (
    <article class="card">
      <a class="thumb" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener">
        {v.thumb ? (
          <img src={v.thumb} alt="" loading="lazy" />
        ) : (
          <div class="thumb-ph" style={{ '--h': hue(v.id) }} />
        )}
        {badge && <span class={`badge ${v.live !== 'none' ? 'badge-live' : ''}`}>{badge}</span>}
      </a>
      {/* A sibling of the thumbnail link, not a child: a button inside a link would also follow the link. */}
      <button
        class={`later ${laterState ?? ''}`}
        title={laterLabel}
        aria-label={`${laterLabel}: "${v.title}"`}
        disabled={!!laterState}
        onClick={() => onLater(v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          {laterState === 'done' ? (
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          ) : (
            <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7.5V12l3 2" />
          )}
        </svg>
      </button>
      <div class="card-foot">
        <div class="card-body">
          <a class="card-title" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener">
            {v.title}
          </a>
          <div class="card-meta">
            {!compact && <span class="card-channel">{v.channelTitle}</span>}
            <span>
              {v.stream && v.live === 'none' ? 'Streamed ' : ''}
              {fmtAge(v.date)}
            </span>
          </div>
        </div>
        <button class="add" title="Add to playlist" aria-label={`Add "${v.title}" to a playlist`} onClick={() => onAdd(v)}>
          {/* list lines with a plus: reads as "add to playlist" rather than a bare + */}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3 6h13M3 12h13M3 18h7M18.5 14.5v7M15 18h7" />
          </svg>
        </button>
      </div>
    </article>
  );
}
