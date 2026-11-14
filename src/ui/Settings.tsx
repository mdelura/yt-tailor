import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtAge } from '../format';
import { INITIAL_LOOKBACK_MS, parsePrefixes } from '../rules';
import { parseSettings } from '../store/settings';
import type { SyncStatus } from '../app';
import type { Channel, Playlist, Rule, Settings as SettingsT } from '../types';

interface Props {
  settings: SettingsT;
  channels: Channel[];
  /** null until loaded */
  playlists: Playlist[] | null;
  signedIn: boolean;
  rulesBusy: boolean;
  sync: SyncStatus;
  onSync: () => void;
  onChange: (s: SettingsT) => void;
  onNeedPlaylists: () => void;
  onRunRules: () => void;
  onClearCache: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

type Tab = 'favourites' | 'rules';

export function Settings(props: Props) {
  const { settings, channels, signedIn, sync, onSync, onChange, onClearCache, onSignOut, onClose } = props;
  const [tab, setTab] = useState<Tab>('favourites');
  const file = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ytailor-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) onChange(parseSettings(await f.text()));
  };

  return (
    <div class="overlay" onClick={onClose}>
      <div class="sheet sheet-tall" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'favourites'} onClick={() => setTab('favourites')}>
              Favourites
            </button>
            <button role="tab" aria-selected={tab === 'rules'} onClick={() => setTab('rules')}>
              Rules{settings.rules.length ? ` (${settings.rules.length})` : ''}
            </button>
          </div>
          <button class="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {tab === 'favourites' ? (
          <Favourites {...props} />
        ) : (
          <Rules {...props} />
        )}

        <div class="actions">
          <button onClick={exportJson}>Export settings</button>
          <button onClick={() => file.current?.click()}>Import settings</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={importJson} />
          <button onClick={onClearCache}>Clear cached data</button>
          {signedIn && <button onClick={onSignOut}>Sign out</button>}
        </div>
        <p class={`note sync ${sync.state === 'error' ? 'bad' : ''}`}>
          <span>
            {sync.state === 'ok' && `Settings synced with your Google Drive ${fmtAge(sync.at)}.`}
            {sync.state === 'syncing' && 'Syncing settings…'}
            {sync.state === 'off' && sync.reason}
            {sync.state === 'error' && `Sync failed: ${sync.message}`}
          </span>
          {sync.state !== 'off' && (
            <button class="link" onClick={onSync} disabled={sync.state === 'syncing'}>
              Sync now
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

function Favourites({ settings, channels, playlists, onChange, onNeedPlaylists }: Props) {
  const [filter, setFilter] = useState('');
  const wl = settings.watchLater;

  useEffect(() => {
    if (!playlists) onNeedPlaylists();
  }, []);

  // Keep the saved choice selectable even before (or without) the playlist list.
  const loaded = playlists ?? [];
  const wlOptions = wl && !loaded.some((p) => p.id === wl.id) ? [{ id: wl.id, title: wl.title, count: 0 }, ...loaded] : loaded;
  const setWatchLater = (id: string, where = wl?.where ?? 'top') => {
    const p = wlOptions.find((x) => x.id === id);
    onChange({ ...settings, watchLater: p ? { id: p.id, title: p.title, where } : undefined });
  };
  const favs = new Set(settings.favourites);

  const toggle = (id: string) => {
    const next = new Set(favs);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...settings, favourites: [...next] });
  };

  const shown = channels
    .filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)) || a.title.localeCompare(b.title));

  return (
    <>
      <label class="field">
        Videos per favourite channel
        <input
          type="number"
          min={1}
          max={10}
          value={settings.perChannel}
          onChange={(e) => {
            const n = Math.round(Number((e.target as HTMLInputElement).value));
            if (n >= 1 && n <= 10) onChange({ ...settings, perChannel: n });
          }}
        />
      </label>

      <div class="field">
        <span>
          Watch Later playlist <small>(clock icon)</small>
        </span>
        <span class="pair">
          <select
            aria-label="Watch Later playlist"
            value={wl?.id ?? ''}
            onChange={(e) => setWatchLater((e.target as HTMLSelectElement).value)}
          >
            <option value="">{playlists || wl ? 'Ask on first use' : 'Sign in to load playlists'}</option>
            {wlOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Where to add"
            value={wl?.where ?? 'top'}
            disabled={!wl}
            onChange={(e) => wl && setWatchLater(wl.id, (e.target as HTMLSelectElement).value as 'top' | 'bottom')}
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </span>
      </div>

      <div class="field">
        <span>
          Favourite channels <small>({favs.size} of {channels.length})</small>
        </span>
        <input
          type="search"
          placeholder="Filter channels"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      </div>
      {channels.length === 0 ? (
        <p class="empty grow">Sign in and refresh to load your subscriptions.</p>
      ) : (
        <ul class="rows channels">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                class={`star ${favs.has(c.id) ? 'on' : ''}`}
                aria-pressed={favs.has(c.id)}
                aria-label={`Favourite ${c.title}`}
                onClick={() => toggle(c.id)}
              >
                {favs.has(c.id) ? '★' : '☆'}
              </button>
              <span class="row-title">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function describe(r: Rule): string {
  const what = r.prefixes.length ? `titles starting with ${r.prefixes.join(' or ')}` : 'every new video';
  return `${what} → ${r.where} of ${r.playlistTitle}`;
}

function Rules({ settings, channels, playlists, rulesBusy, onChange, onNeedPlaylists, onRunRules }: Props) {
  const [channelId, setChannelId] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [prefixes, setPrefixes] = useState('');
  const [where, setWhere] = useState<'top' | 'bottom'>('top');

  useEffect(() => {
    if (!playlists) onNeedPlaylists();
  }, []);

  const sortedChannels = [...channels].sort((a, b) => a.title.localeCompare(b.title));
  const setRules = (rules: Rule[]) => onChange({ ...settings, rules });

  const add = (e: Event) => {
    e.preventDefault();
    const channel = channels.find((c) => c.id === channelId);
    const playlist = playlists?.find((p) => p.id === playlistId);
    if (!channel || !playlist) return;
    setRules([
      ...settings.rules,
      {
        id: crypto.randomUUID(),
        enabled: true,
        channelId: channel.id,
        channelTitle: channel.title,
        prefixes: parsePrefixes(prefixes),
        playlistId: playlist.id,
        playlistTitle: playlist.title,
        where,
        since: Date.now() - INITIAL_LOOKBACK_MS,
        handled: [],
      },
    ]);
    setPrefixes('');
  };

  return (
    <>
      <p class="note intro">
        Rules run after every feed refresh while you are signed in. A new rule starts with videos from the last 24
        hours, then picks up everything new since its last run.
      </p>

      {settings.rules.length === 0 ? (
        <p class="empty">No rules yet.</p>
      ) : (
        <ul class="rows rules">
          {settings.rules.map((r) => (
            <li key={r.id}>
              <input
                type="checkbox"
                checked={r.enabled}
                aria-label={`Enable rule for ${r.channelTitle}`}
                onChange={() => setRules(settings.rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}
              />
              <span class="row-title">
                {r.channelTitle}
                <small>{describe(r)}</small>
                <small>{r.lastRun ? `Last run ${fmtAge(r.lastRun)}` : 'Not run yet'}</small>
              </span>
              <button
                class="icon"
                aria-label={`Delete rule for ${r.channelTitle}`}
                title="Delete rule"
                onClick={() => setRules(settings.rules.filter((x) => x.id !== r.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form class="rule-form" onSubmit={add}>
        <strong>New rule</strong>
        <label>
          Channel
          <select value={channelId} onChange={(e) => setChannelId((e.target as HTMLSelectElement).value)} required>
            <option value="">{channels.length ? 'Choose a subscription…' : 'Refresh the feed first'}</option>
            {sortedChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title starts with
          <input
            type="text"
            placeholder="Wstawaki, Knotki (empty = every video)"
            value={prefixes}
            onInput={(e) => setPrefixes((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Add to
          <span class="pair">
            <select value={playlistId} onChange={(e) => setPlaylistId((e.target as HTMLSelectElement).value)} required>
              <option value="">{playlists ? 'Choose a playlist…' : 'Sign in to load playlists'}</option>
              {(playlists ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <select value={where} onChange={(e) => setWhere((e.target as HTMLSelectElement).value as 'top' | 'bottom')}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </span>
        </label>
        <div class="actions">
          <button type="submit" class="primary" disabled={!channelId || !playlistId}>
            Add rule
          </button>
          <button type="button" onClick={onRunRules} disabled={rulesBusy || settings.rules.length === 0}>
            {rulesBusy ? 'Running…' : 'Run rules now'}
          </button>
        </div>
      </form>
    </>
  );
}
