import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AuthError, describeError } from './api/client';
import { favouriteGroups, fetchChannelVideos, fetchSubscriptions, keepSubscribed, mergeVideos } from './api/feed';
import { addToPlaylist, fetchPlaylists, isInPlaylist, type Where } from './api/playlists';
import { runRules, summarise } from './rules';
import { syncSettings } from './sync';
import { DAILY_QUOTA, getQuota } from './api/quota';
import { describeDriveError, readRemote, writeRemote } from './api/drive';
import { CLIENT_ID, getToken, hasDriveScope, signIn, signOut } from './auth';
import { demoChannels, demoPlaylists, demoVideos, IS_DEMO } from './demo';
import { fmtAge } from './format';
import { cacheClear, cacheGet, cacheSet } from './store/cache';
import { loadSettings, saveSettings } from './store/settings';
import type { Channel, Playlist, Settings as SettingsT, Video } from './types';

/** Settings sync state shown in the Settings panel. */
export type SyncStatus =
  | { state: 'off'; reason: string }
  | { state: 'syncing' }
  | { state: 'ok'; at: number }
  | { state: 'error'; message: string };
import { Feed } from './ui/Feed';
import { PlaylistLinks } from './ui/PlaylistLinks';
import { PlaylistMenu } from './ui/PlaylistMenu';
import { Settings } from './ui/Settings';

const FEED_TTL = 30 * 60_000;
const SUBS_TTL = 24 * 60 * 60_000;
const PLAYLISTS_TTL = 60 * 60_000;
const SYNC_DEBOUNCE = 2000;
const SYNC_ON_FOCUS_AFTER = 60_000;

export function App() {
  const [settings, setSettings] = useState<SettingsT>(loadSettings);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [feedAt, setFeedAt] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [signedIn, setSignedIn] = useState(() => IS_DEMO || !!getToken());
  const [progress, setProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState<Video | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({
    state: 'off',
    reason: IS_DEMO ? 'Sync is off in the demo.' : 'Sign in to sync settings between devices.',
  });
  const [quota, setQuota] = useState(getQuota);

  // Latest values for async code that outlives a render.
  const live = useRef({
    settings,
    channels,
    videos,
    busy: false,
    rulesBusy: false,
    syncBusy: false,
    syncAgain: false,
    syncTimer: 0,
    syncedAt: 0,
  });
  live.current.settings = settings;
  live.current.channels = channels;
  live.current.videos = videos;

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  };

  const fail = (e: unknown) => {
    if (e instanceof AuthError) setSignedIn(false);
    notify(describeError(e));
  };

  /** Stores settings locally. `touch` marks them as edited now and schedules an upload. */
  const updateSettings = (next: SettingsT, touch = true) => {
    const s = touch ? { ...next, updatedAt: Date.now() } : next;
    live.current.settings = s;
    setSettings(s);
    saveSettings(s);
    if (touch) {
      clearTimeout(live.current.syncTimer);
      live.current.syncTimer = window.setTimeout(syncNow, SYNC_DEBOUNCE);
    }
  };

  /** Two-way settings sync with the Drive app-data folder. Safe to call at any time. */
  async function syncNow() {
    if (IS_DEMO) return setSync({ state: 'off', reason: 'Sync is off in the demo.' });
    if (!getToken()) return setSync({ state: 'off', reason: 'Sign in to sync settings between devices.' });
    if (!hasDriveScope()) {
      return setSync({
        state: 'off',
        reason: 'Sync is off: sign out and sign in again, keeping the Google Drive box ticked.',
      });
    }
    if (live.current.syncBusy) {
      live.current.syncAgain = true;
      return;
    }
    live.current.syncBusy = true;
    setSync({ state: 'syncing' });
    try {
      const before = live.current.settings;
      const res = await syncSettings(before, { readRemote, writeRemote });
      if (res.pulled) {
        // Edited while we were talking to Drive: keep the edit and go round again.
        if (live.current.settings !== before) live.current.syncAgain = true;
        else updateSettings(res.settings, false);
      }
      live.current.syncedAt = Date.now();
      setSync({ state: 'ok', at: live.current.syncedAt });
    } catch (e) {
      if (e instanceof AuthError) {
        setSignedIn(false);
        setSync({ state: 'off', reason: 'Sign in to sync settings between devices.' });
      } else {
        setSync({ state: 'error', message: describeDriveError(e) });
      }
    } finally {
      live.current.syncBusy = false;
      if (live.current.syncAgain) {
        live.current.syncAgain = false;
        syncNow();
      }
    }
  }

  /** Applies playlist rules to the feed currently loaded. `manual` also reports "nothing to do". */
  async function runRulesNow(manual = false) {
    const rules = live.current.settings.rules;
    if (!rules.some((r) => r.enabled)) {
      if (manual) notify('No enabled rules to run.');
      return;
    }
    if (!IS_DEMO && !getToken()) {
      setSignedIn(false);
      if (manual) notify('Sign in to run rules.');
      return;
    }
    if (live.current.rulesBusy) return;
    live.current.rulesBusy = true;
    setRulesBusy(true);
    try {
      const deps = IS_DEMO
        ? { isInPlaylist: async () => false, add: async () => {} }
        : { isInPlaylist, add: addToPlaylist };
      const res = await runRules(rules, live.current.videos, deps);
      // Merge only the run's bookkeeping, so edits made while it ran are kept.
      const ran = new Map(res.rules.map((r) => [r.id, r]));
      const current = live.current.settings;
      updateSettings({
        ...current,
        rules: current.rules.map((r) => {
          const done = ran.get(r.id);
          return done ? { ...r, handled: done.handled, lastRun: done.lastRun } : r;
        }),
      });
      const summary = res.added.length ? `Rules added ${summarise(res.added)}` : '';
      if (res.error) {
        if (res.error instanceof AuthError) setSignedIn(false);
        notify(`${summary ? summary + ', then stopped: ' : 'Rules stopped: '}${describeError(res.error)}`);
      } else if (summary) {
        notify(
          summary +
            (res.remaining ? ` (${res.remaining} more next run)` : '') +
            (IS_DEMO ? ' (demo, nothing was changed)' : ''),
        );
      } else if (manual) {
        notify('Rules ran: nothing new to add.');
      }
    } finally {
      live.current.rulesBusy = false;
      setRulesBusy(false);
      setQuota(getQuota());
    }
  }

  async function refresh(force = false) {
    if (live.current.busy) return;
    if (IS_DEMO) {
      setChannels(demoChannels());
      setVideos(demoVideos());
      setFeedAt(Date.now());
      return;
    }
    live.current.busy = true;
    setProgress('Loading subscriptions…');
    try {
      let chans = live.current.channels;
      const subs = await cacheGet<Channel[]>('subs');
      if (force || !subs || Date.now() - subs.at > SUBS_TTL || chans.length === 0) {
        chans = await fetchSubscriptions();
        await cacheSet('subs', chans);
        setChannels(chans);
      }

      // Favourites first so the top section fills in quickly.
      const favs = new Set(live.current.settings.favourites);
      const first = chans.filter((c) => favs.has(c.id));
      const rest = chans.filter((c) => !favs.has(c.id));
      let done = 0;
      const onProgress = () => setProgress(`Loading channels ${++done} / ${chans.length}`);

      let merged = keepSubscribed(live.current.videos, chans);
      for (const part of [first, rest]) {
        if (part.length === 0) continue;
        merged = mergeVideos(merged, await fetchChannelVideos(part, onProgress));
        setVideos(merged);
      }
      live.current.videos = merged;
      await cacheSet('feed', merged);
      setFeedAt(Date.now());
      await runRulesNow();
    } catch (e) {
      fail(e);
    } finally {
      live.current.busy = false;
      setProgress(null);
      setQuota(getQuota());
    }
  }

  // Start-up: show the cached feed immediately, then refresh if it is stale.
  useEffect(() => {
    (async () => {
      if (IS_DEMO) return refresh();
      const [subs, feed] = await Promise.all([cacheGet<Channel[]>('subs'), cacheGet<Video[]>('feed')]);
      if (subs) {
        setChannels(subs.value);
        live.current.channels = subs.value;
      }
      if (feed) {
        const fresh = mergeVideos(feed.value, []);
        setVideos(fresh);
        live.current.videos = fresh;
        setFeedAt(feed.at);
      }
      // Settings first, so a refresh on this device uses favourites and rules from the other one.
      await syncNow();
      if (getToken() && (!feed || Date.now() - feed.at > FEED_TTL)) refresh();
    })();

    // Coming back to a tab that sat open: pick up changes made elsewhere.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - live.current.syncedAt > SYNC_ON_FOCUS_AFTER) {
        syncNow();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  async function onSignIn() {
    try {
      await signIn();
      setSignedIn(true);
      await syncNow();
      refresh();
    } catch (e) {
      fail(e);
    }
  }

  /** Shows cached playlists at once, then refetches if the cache is over an hour old and we are signed in. */
  async function loadPlaylists() {
    if (IS_DEMO) return setPlaylists(demoPlaylists());
    try {
      const cached = await cacheGet<Playlist[]>('playlists');
      if (cached) setPlaylists(cached.value);
      if (cached && Date.now() - cached.at < PLAYLISTS_TTL) return;
      if (!getToken()) {
        setSignedIn(false);
        return;
      }
      const fresh = await fetchPlaylists();
      setPlaylists(fresh);
      await cacheSet('playlists', fresh);
    } finally {
      setQuota(getQuota());
    }
  }

  async function openAdd(v: Video) {
    if (!signedIn) return notify('Sign in to add videos to playlists.');
    setAdding(v);
    try {
      await loadPlaylists();
    } catch (e) {
      setAdding(null);
      fail(e);
    }
  }

  async function openMenu() {
    setShowMenu(true);
    try {
      await loadPlaylists();
    } catch (e) {
      setShowMenu(false);
      fail(e);
    }
  }

  async function pick(p: Playlist, where: Where) {
    if (!adding) return;
    setAddBusy(true);
    try {
      if (!IS_DEMO) await addToPlaylist(p.id, adding.id, where);
      updateSettings({ ...live.current.settings, lastPlaylist: p.id });
      notify(`Added to the ${where} of “${p.title}”${IS_DEMO ? ' (demo, nothing was changed)' : ''}`);
      setAdding(null);
    } catch (e) {
      fail(e);
      if (e instanceof AuthError) setAdding(null);
    } finally {
      setAddBusy(false);
      setQuota(getQuota());
    }
  }

  const groups = useMemo(
    () => favouriteGroups(videos, channels, settings.favourites, settings.perChannel),
    [videos, channels, settings.favourites, settings.perChannel],
  );

  return (
    <>
      <header class="top">
        <h1>
          <span class="mark">Y</span>Tailor
        </h1>
        <span class="status">
          {progress ?? (feedAt ? `Updated ${fmtAge(feedAt)}` : '')}
          {IS_DEMO && ' · demo data'}
        </span>
        <button aria-haspopup="dialog" aria-expanded={showMenu} title="Open a playlist on YouTube" onClick={openMenu}>
          <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M3 6h14M3 12h9M3 18h9" />
            <path class="solid" d="M15.5 11.5v8l6.5-4z" />
          </svg>
          <span class="label">Playlists</span>
        </button>
        {signedIn ? (
          <button onClick={() => refresh(true)} disabled={!!progress}>
            Refresh
          </button>
        ) : (
          <button class="primary" onClick={onSignIn} disabled={!CLIENT_ID}>
            Sign in with Google
          </button>
        )}
        <button class="icon" aria-label="Settings" title="Settings" onClick={() => setShowSettings(true)}>
          <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        {showMenu && (
          <PlaylistLinks
            playlists={playlists}
            signedIn={signedIn}
            lastPlaylist={settings.lastPlaylist}
            onClose={() => setShowMenu(false)}
          />
        )}
      </header>

      {!CLIENT_ID && !IS_DEMO && (
        <p class="banner">
          No Google client ID configured. Follow the README to create one and put it in <code>.env</code>, or open{' '}
          <a href="?demo">the demo</a> to try the layout with sample data.
        </p>
      )}

      <Feed groups={groups} videos={videos} onAdd={openAdd} onOpenSettings={() => setShowSettings(true)} />

      <footer>
        <span>
          ≈ {quota.toLocaleString()} / {DAILY_QUOTA.toLocaleString()} API units used today
        </span>
        <span>
          Videos and data from <a href="https://www.youtube.com" target="_blank" rel="noopener">YouTube</a>
        </span>
        <a href="privacy.html">Privacy</a>
      </footer>

      {adding && (
        <PlaylistMenu
          video={adding}
          playlists={playlists}
          lastPlaylist={settings.lastPlaylist}
          busy={addBusy}
          onPick={pick}
          onClose={() => setAdding(null)}
        />
      )}
      {showSettings && (
        <Settings
          settings={settings}
          channels={channels}
          signedIn={signedIn && !IS_DEMO}
          playlists={playlists}
          rulesBusy={rulesBusy}
          sync={sync}
          onSync={syncNow}
          onNeedPlaylists={() => loadPlaylists().catch(fail)}
          onRunRules={() => runRulesNow(true)}
          onChange={updateSettings}
          onClearCache={async () => {
            await cacheClear();
            setVideos([]);
            setChannels([]);
            setPlaylists(null);
            setFeedAt(null);
            notify('Cached data cleared.');
          }}
          onSignOut={() => {
            signOut();
            setSignedIn(false);
            setSync({ state: 'off', reason: 'Sign in to sync settings between devices.' });
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
