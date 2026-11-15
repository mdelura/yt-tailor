import { fmtAge, fmtDuration } from '../format';
import type { Where } from '../api/playlists';
import type { Video } from '../types';

interface Props {
  video: Video;
  /** Hide the channel name (used inside a favourite channel's own row). */
  compact?: boolean;
  onAdd: (v: Video) => void;
  /** Name of the playlist standing in for Watch Later, once one is chosen. */
  laterTitle?: string;
  laterState?: LaterState;
  onLater: (v: Video, where: Where) => void;
}

export interface LaterState {
  /** Where the video was last put in the Watch Later playlist. */
  done?: Where;
  /** Where it is being put right now. */
  busy?: Where;
}

function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function VideoCard({ video: v, compact, onAdd, laterTitle, laterState, onLater }: Props) {
  const later = laterTitle ?? 'Watch Later';
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
      <div class={`later ${laterState?.done || laterState?.busy ? 'active' : ''}`} role="group" aria-label={`Save to ${later}`}>
        {(['top', 'bottom'] as const).map((where) => {
          const on = laterState?.done === where;
          const other = laterState?.done && !on;
          const title = on
            ? `At the ${where} of ${later}`
            : `${other ? 'Move' : 'Save'} to the ${where} of ${later}`;
          return (
            <button
              key={where}
              class={`${on ? 'on' : ''} ${laterState?.busy === where ? 'busy' : ''}`}
              title={title}
              aria-label={`${title}: "${v.title}"`}
              aria-pressed={on}
              disabled={on || !!laterState?.busy}
              onClick={() => onLater(v, where)}
            >
              {/* clock with an arrow: up for the top of the list, down for the bottom */}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M19.5 10.5A8 8 0 1 0 12 20M11 8v4.5l2.5 1.5" />
                <path d={where === 'top' ? 'M19 22v-7M16 17.5l3-3 3 3' : 'M19 13v7M16 17.5l3 3 3-3'} />
              </svg>
            </button>
          );
        })}
      </div>
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
