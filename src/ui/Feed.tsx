import { useEffect, useRef, useState } from 'preact/hooks';
import type { FavouriteGroup } from '../api/feed';
import type { Video } from '../types';
import { VideoCard } from './VideoCard';

const PAGE = 48;

interface Props {
  groups: FavouriteGroup[];
  videos: Video[];
  onAdd: (v: Video) => void;
  onOpenSettings: () => void;
}

export function Feed({ groups, videos, onAdd, onOpenSettings }: Props) {
  const [visible, setVisible] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((n) => n + PAGE);
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [videos.length > visible]);

  return (
    <main>
      <section>
        <h2>Favourites</h2>
        {groups.length === 0 ? (
          <p class="empty">
            No favourites yet.{' '}
            <button class="link" onClick={onOpenSettings}>
              Pick favourite channels
            </button>
          </p>
        ) : (
          groups.map((g) => (
            <div class="group" key={g.channel.id}>
              <h3>
                {g.channel.thumb && <img src={g.channel.thumb} alt="" />}
                <a href={`https://www.youtube.com/channel/${g.channel.id}`} target="_blank" rel="noopener">
                  {g.channel.title}
                </a>
              </h3>
              <div class="grid">
                {g.videos.map((v) => (
                  <VideoCard key={v.id} video={v} compact onAdd={onAdd} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>All recent</h2>
        {videos.length === 0 ? (
          <p class="empty">Nothing here yet. Sign in and refresh to load your subscriptions.</p>
        ) : (
          <div class="grid">
            {videos.slice(0, visible).map((v) => (
              <VideoCard key={v.id} video={v} onAdd={onAdd} />
            ))}
          </div>
        )}
        {videos.length > visible && <div ref={sentinel} class="sentinel" />}
      </section>
    </main>
  );
}
