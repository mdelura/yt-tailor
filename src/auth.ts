// Google Identity Services token flow (browser only, no backend, no refresh token).
// The access token lives for about an hour; after that the user taps "Sign in" again.
// It is kept in localStorage so every tab and a browser restart within that hour stay signed in.
// The account's email is remembered as a login hint, so signing in again skips the account
// chooser and the Google popup usually closes by itself.

declare const google: any;

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
/** Hidden per-app folder in the user's Drive; used only to sync settings between devices. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Only to read the account's email, used as the login hint for the next sign-in. */
const EMAIL_SCOPE = 'openid email';
const SCOPE = `${YOUTUBE_SCOPE} ${DRIVE_SCOPE} ${EMAIL_SCOPE}`;
const KEY = 'tailor.token';
/** Email of the account last signed in; present until an explicit sign-out. */
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
    const { email } = (await res.json()) as { email?: string };
    if (email) localStorage.setItem(HINT_KEY, email);
  } catch {
    // Only a convenience for the next sign-in.
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
      login_hint: hint().includes('@') ? hint() : undefined,
      callback: (resp: any) => {
        if (resp.error || !resp.access_token) {
          return reject(new Error(resp.error_description || resp.error || 'Sign-in failed'));
        }
        const fresh: StoredToken = {
          token: resp.access_token,
          expiresAt: Date.now() + Number(resp.expires_in ?? 3600) * 1000,
          scope: typeof resp.scope === 'string' ? resp.scope : '',
        };
        localStorage.setItem(KEY, JSON.stringify(fresh));
        // Marks the session as one to renew even if the email lookup fails.
        if (!hint()) localStorage.setItem(HINT_KEY, '-');
        void rememberAccount(fresh.token);
        resolve(fresh.token);
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
