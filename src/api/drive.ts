// One JSON file in the user's hidden Drive app-data folder. Only this app can see it.
import { clearToken, getToken } from '../auth';
import { AuthError } from './client';

const FILE_NAME = 'ytailor-settings.json';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (!token) throw new AuthError();
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    clearToken();
    throw new AuthError();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const reason: string = err?.error?.errors?.[0]?.reason ?? err?.error?.status ?? '';
    throw new DriveError(res.status, reason, err?.error?.message ?? `Google Drive error ${res.status}`);
  }
  return res;
}

export interface Remote {
  /** Drive file id, or null when nothing has been saved yet. */
  id: string | null;
  json: string | null;
}

export async function readRemote(): Promise<Remote> {
  const q = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}'`,
    orderBy: 'modifiedTime desc',
    fields: 'files(id)',
    pageSize: '1',
  });
  const list = await (await call(`${FILES}?${q}`)).json();
  const id: string | undefined = list.files?.[0]?.id;
  if (!id) return { id: null, json: null };
  const json = await (await call(`${FILES}/${id}?alt=media`)).text();
  return { id, json };
}

/** Creates the file when `id` is null, otherwise overwrites it. Returns the file id. */
export async function writeRemote(id: string | null, json: string): Promise<string> {
  if (id) {
    await call(`${UPLOAD}/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    return id;
  }
  const boundary = 'ytailor-' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id as string;
}

export function describeDriveError(e: unknown): string {
  if (e instanceof DriveError) {
    if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|PERMISSION_DENIED/i.test(e.reason + e.message) && /not been used|disabled|enable/i.test(e.message)) {
      return 'Google Drive API is not enabled in your Google Cloud project (see README).';
    }
    if (e.status === 403) return 'No permission for Drive: sign out and sign in again, keeping the Drive box ticked.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
