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

/** YouTube's reserved id for the signed-in user's Watch Later playlist. */
const WATCH_LATER = 'WL';

const pageUrl =(id: string) => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
/** `playnext=1` makes YouTube jump straight into watch mode on the first video. */
const playUrl = (id: string) => `${pageUrl(id)}&playnext=1`;

/** Header dropdown: jump to a playlist on youtube.com, either its page or straight into playback. */
export function PlaylistLinks({ playlists, signedIn, playlistUsed, onOpen, onClose }: Props) {
  const sorted = playlists ? byRecentUse(playlists, playlistUsed) : null;
  const open = (id: string) => {
    onOpen(id);
    onClose();
  };
  const row = (id: string, title: string, sub: string, onClick: () => void) => (
    <li key={id}>
      <a class="row-title" href={pageUrl(id)} target="_blank" rel="noopener" onClick={onClick}>
        {title}
        <small>{sub}</small>
      </a>
      <a class="btn play" href={playUrl(id)} target="_blank" rel="noopener" aria-label={`Play ${title}`} onClick={onClick}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
        Play
      </a>
    </li>
  );
  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="menu" role="dialog" aria-label="Playlists">
        <ul class="rows">
          {/* YouTube's own Watch Later: closed to the API, but its page opens fine on youtube.com. Always first. */}
          {row(WATCH_LATER, 'Watch Later', 'YouTube', onClose)}
          {sorted?.map((p) => row(p.id, p.title, `${p.count} videos`, () => open(p.id)))}
        </ul>
        {!sorted ? (
          <p class="empty">{signedIn ? 'Loading playlists…' : 'Sign in to see your playlists.'}</p>
        ) : (
          sorted.length === 0 && <p class="empty">You have no playlists yet.</p>
        )}
      </div>
    </>
  );
}
