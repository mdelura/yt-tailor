import { clearToken, getToken } from '../auth';
import { addQuota } from './quota';

const BASE = 'https://www.googleapis.com/youtube/v3/';

export class AuthError extends Error {
  constructor() {
    super('Sign in to continue');
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

interface Options {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Quota units this call costs (1 for list calls, 50 for inserts). */
  cost?: number;
}

export async function yt<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  { method = 'GET', body, cost = 1 }: Options = {},
): Promise<T> {
  const token = getToken();
  if (!token) throw new AuthError();

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Failed calls are charged too, so count before looking at the status.
  addQuota(cost);

  if (res.status === 401) {
    clearToken();
    throw new AuthError();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const reason: string = err?.error?.errors?.[0]?.reason ?? '';
    const message: string = err?.error?.message ?? `YouTube API error ${res.status}`;
    throw new ApiError(res.status, reason, message);
  }
  return (await res.json()) as T;
}

/** Follows nextPageToken until the list is exhausted. */
export async function ytAll<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await yt<Page<T>>(path, { ...params, pageToken });
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded') {
      return 'Daily YouTube API quota is used up. It resets at midnight Pacific Time.';
    }
    if (e.reason === 'manualSortRequired') {
      return 'This playlist is not manually ordered, so videos can only be added to the bottom.';
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
