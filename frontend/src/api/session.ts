/**
 * Operator session: the name shown on audit records and the backend operator
 * token. Kept in sessionStorage for this tab only; never part of the bundle.
 */
export interface Session {
  actor: string;
  token: string | null;
}
const KEY = 'api-guardian.session.v1';
const listeners = new Set<() => void>();

export function loadSession(): Session {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return { actor: '', token: null };
    const p = JSON.parse(raw) as Partial<Session>;
    return { actor: typeof p.actor === 'string' ? p.actor : '', token: typeof p.token === 'string' && p.token ? p.token : null };
  } catch {
    return { actor: '', token: null };
  }
}
export function saveSession(s: Session): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
  for (const l of listeners) l();
}
export function clearSession(): void {
  saveSession({ actor: '', token: null });
}
export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
