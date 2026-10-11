import { loadSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BASE = ((import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '').replace(/\/$/, '');

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function qs(query: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const { token } = loadSession();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'network error');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const e = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? (text || res.statusText), e?.details);
  }
  return parsed as T;
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.code === 'BACKEND_UNREACHABLE') return 'Backend unreachable. Start it with `npm run dev` in Hackwave/Backend; the dashboard reconnects automatically.';
    if (err.status === 401) return 'Sign in with the operator token to perform this action.';
    const detail = Array.isArray(err.details) ? ` (${(err.details as Array<{ path?: string; message?: string }>).map((d) => `${d.path ?? ''} ${d.message ?? ''}`.trim()).join('; ')})` : '';
    return `${err.message}${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}
