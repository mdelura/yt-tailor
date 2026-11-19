// Google Identity Services token flow (browser only, no backend, no refresh token).
// The access token lives for about an hour; after that it is renewed by a silent redirect
// on the next page load (see renewOnLoad), or the user taps "Continue".
// It is kept in localStorage so every tab and a browser restart within that hour stay signed in.
// The account's ID is remembered as a login hint, so signing in again skips the account
// chooser and the Google popup usually closes by itself.

declare const google: any;

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
/** Hidden per-app folder in the user's Drive; used only to sync settings between devices. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Only to read the account's email, used as the login hint for the next sign-in. */
const EMAIL_SCOPE = 'openid email';
const SCOPE = `${YOUTUBE_SCOPE} ${DRIVE_SCOPE} ${EMAIL_SCOPE}`;
const KEY = 'tailor.token';
/** Google account ID (or, from older versions, email) of the last account; kept until sign-out. */
const HINT_KEY = 'tailor.hint';

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

interface StoredToken {
  token: string;
  expiresAt: number;
  /** Space-separated scopes Google actually granted (the user can untick Drive). */
  scope?: string;
}

function stored(): StoredToken | null {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StoredToken | null;
    // 60 s margin so a request never goes out with a token about to expire.
    return t && t.expiresAt - 60_000 > Date.now() ? t : null;
  } catch {
    return null;
  }
}

/** True when the current token may use the Drive app-data folder (settings sync). */
export function hasDriveScope(): boolean {
  return (stored()?.scope ?? '').split(' ').includes(DRIVE_SCOPE);
}

export function getToken(): string | null {
  return stored()?.token ?? null;
}

/** When the current token stops being usable (with the safety margin), or null when there is none. */
export function tokenExpiresAt(): number | null {
  const t = stored();
  return t ? t.expiresAt - 60_000 : null;
}

function hint(): string {
  try {
    return localStorage.getItem(HINT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** True when the user signed in before and never signed out, so a sign-in now is a renewal. */
export function sessionExpired(): boolean {
  return !getToken() && !!hint();
}

async function rememberAccount(token: string): Promise<void> {
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    // The account ID (sub) is preferred: for a YouTube Brand Account the email is a
    // pseudo-address (…@pages.plusgoogle.com) that the account chooser may not match.
    const { sub, email } = (await res.json()) as { sub?: string; email?: string };
    const id = sub || email;
    if (id) localStorage.setItem(HINT_KEY, id);
  } catch {
    // Only a convenience for the next sign-in.
  }
}

function saveToken(token: string, expiresIn: unknown, scope: unknown): string {
  const fresh: StoredToken = {
    token,
    expiresAt: Date.now() + Number(expiresIn ?? 3600) * 1000,
    scope: typeof scope === 'string' ? scope : '',
  };
  localStorage.setItem(KEY, JSON.stringify(fresh));
  // Marks the session as one to renew even if the account lookup fails.
  if (!hint()) localStorage.setItem(HINT_KEY, '-');
  void rememberAccount(token);
  return token;
}

// Silent renewal: a full-page redirect to Google with prompt=none. Unlike the popup it needs
// no click, so it can run on page load. Google sends the browser straight back with a new
// token when the account is still signed in and has already granted access, or with an error
// (then the "Continue" banner is shown as before). The redirect URI has to be listed under
// "Authorised redirect URIs" of the OAuth client.

/** CSRF check for the redirect round trip; lives only in this tab. */
const STATE_KEY = 'tailor.renewState';
/** When silent renewal was last tried; stops a redirect loop when Google says no. */
const ATTEMPT_KEY = 'tailor.renewAt';
const RETRY_AFTER_MS = 15 * 60_000;

/** This page without query, hash or a trailing index.html, as registered with Google. */
function redirectUri(): string {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

/**
 * Call once at startup, before rendering. Picks up a token Google sent back, or, when the
 * previous sign-in has run out, leaves for Google to renew it. Returns true when leaving.
 */
export function renewOnLoad(): boolean {
  try {
    const back = new URLSearchParams(location.hash.slice(1));
    if (back.has('state') && (back.has('access_token') || back.has('error'))) {
      const expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
      // Drop the token from the address bar and history.
      history.replaceState(null, '', location.pathname + location.search);
      const token = back.get('access_token');
      if (token && expected && back.get('state') === expected) {
        saveToken(token, back.get('expires_in'), back.get('scope'));
      }
      return false;
    }

    if (!CLIENT_ID || !sessionExpired()) return false;
    if (Date.now() - Number(localStorage.getItem(ATTEMPT_KEY) ?? 0) < RETRY_AFTER_MS) return false;

    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    localStorage.setItem(ATTEMPT_KEY, String(Date.now()));
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      prompt: 'none',
      state,
    });
    if (hint() !== '-') params.set('login_hint', hint());
    location.replace(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    return true;
  } catch {
    // Storage blocked or similar: fall back to the "Continue" banner.
    return false;
  }
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
}

function gisReady(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Google sign-in script failed to load (blocked by an extension?)'));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Opens the Google popup. Must be called from a click handler or the popup is blocked. */
export async function signIn(): Promise<string> {
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  await gisReady();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      // Same account as last time: no account chooser, so the popup usually closes by itself.
      // The hint is the account ID (or an email saved by older versions); '-' means unknown.
      login_hint: hint() && hint() !== '-' ? hint() : undefined,
      callback: (resp: any) => {
        if (resp.error || !resp.access_token) {
          return reject(new Error(resp.error_description || resp.error || 'Sign-in failed'));
        }
        resolve(saveToken(resp.access_token, resp.expires_in, resp.scope));
      },
      error_callback: (err: any) => reject(new Error(err?.message || 'Sign-in was cancelled')),
    });
    // Empty prompt: no consent screen after the first grant.
    client.requestAccessToken({ prompt: '' });
  });
}

export function signOut(): void {
  const token = getToken();
  clearToken();
  localStorage.removeItem(HINT_KEY);
  if (token && typeof google !== 'undefined') google.accounts.oauth2.revoke(token, () => {});
}
