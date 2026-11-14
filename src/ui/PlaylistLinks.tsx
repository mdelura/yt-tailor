import { byRecentUse } from '../api/playlists';
import type { Playlist } from '../types';

interface Props {
  /** null while loading (or when signed out with nothing cached) */
  playlists: Playlist[] | null;
  signedIn: boolean;
  playlistUsed: Record<string, number>;
  /** A playlist link was followed. */
  onOpen: (id: string) => void;
  onClose: () => void;
}

const pageUrl = (id: string) => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
/** `playnext=1` makes YouTube jump straight into watch mode on the first video. */
const playUrl = (id: string) => `${pageUrl(id)}&playnext=1`;

/** Header dropdown: jump to a playlist on youtube.com, either its page or straight into playback. */
export function PlaylistLinks({ playlists, signedIn, playlistUsed, onOpen, onClose }: Props) {
  const sorted = playlists ? byRecentUse(playlists, playlistUsed) : null;
  const open = (id: string) => {
    onOpen(id);
    onClose();
  };
  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="menu" role="dialog" aria-label="Playlists">
        {!sorted ? (
          <p class="empty">{signedIn ? 'Loading playlists…' : 'Sign in to see your playlists.'}</p>
        ) : sorted.length === 0 ? (
          <p class="empty">You have no playlists yet.</p>
        ) : (
          <ul class="rows">
            {sorted.map((p) => (
              <li key={p.id}>
                <a class="row-title" href={pageUrl(p.id)} target="_blank" rel="noopener" onClick={() => open(p.id)}>
                  {p.title}
                  <small>{p.count} videos</small>
                </a>
                <a
                  class="btn play"
                  href={playUrl(p.id)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Play ${p.title}`}
                  onClick={() => open(p.id)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M7 4.5v15l12-7.5z" />
                  </svg>
                  Play
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
