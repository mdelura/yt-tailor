import { byRecentUse, type Where } from '../api/playlists';
import type { Playlist, Video } from '../types';

interface Props {
  video: Video;
  /** null while loading */
  playlists: Playlist[] | null;
  playlistUsed: Record<string, number>;
  busy: boolean;
  onPick: (p: Playlist, where: Where) => void;
  onClose: () => void;
}

export function PlaylistMenu({ video, playlists, playlistUsed, busy, onPick, onClose }: Props) {
  // Most recently used first, so repeat adds are one tap.
  const sorted = playlists ? byRecentUse(playlists, playlistUsed) : null;
  const lastPlaylist = sorted?.[0] && playlistUsed[sorted[0].id] ? sorted[0].id : undefined;
  return (
    <div class="overlay" onClick={onClose}>
      <div class="sheet" role="dialog" aria-label="Add to playlist" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <strong>Add to playlist</strong>
            <div class="sheet-sub">{video.title}</div>
          </div>
          <button class="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {!sorted ? (
          <p class="empty">Loading playlists…</p>
        ) : sorted.length === 0 ? (
          <p class="empty">You have no playlists yet. Create one on YouTube first.</p>
        ) : (
          <ul class="rows">
            {sorted.map((p) => (
              <li key={p.id}>
                <span class="row-title">
                  {p.title}
                  <small>{p.count} videos{p.id === lastPlaylist ? ' · last used' : ''}</small>
                </span>
                <button disabled={busy} onClick={() => onPick(p, 'top')}>
                  ↑ Top
                </button>
                <button disabled={busy} onClick={() => onPick(p, 'bottom')}>
                  ↓ Bottom
                </button>
              </li>
            ))}
          </ul>
        )}
        <p class="note">Watch Later is not available to third-party apps. Each add uses 50 quota units.</p>
      </div>
    </div>
  );
}
