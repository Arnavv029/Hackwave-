import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guardian } from '../api/guardian';
import { subscribeEvents } from '../api/events';
import { describeError } from '../api/client';
import { loadSession, onSessionChange, saveSession, type Session } from '../api/session';
import type { AuditDto, IncidentDto, MonitorDto, OverviewDto, ProposalDto, SettingsDto, WhoamiDto } from '../api/types';

/**
 * Single source of truth for the dashboard. Loads everything from the backend,
 * refreshes on server-sent events (debounced) and on a slow poll as fallback,
 * and exposes the operator session.
 */
export interface GuardianState {
  monitors: MonitorDto[];
  incidents: IncidentDto[];
  proposals: ProposalDto[];
  audit: AuditDto[];
  overview: OverviewDto | null;
  settings: SettingsDto | null;
  whoami: WhoamiDto | null;
  loading: boolean;
  error: string | null;
  live: boolean;
  lastUpdated: number | null;
}

const EMPTY: GuardianState = { monitors: [], incidents: [], proposals: [], audit: [], overview: null, settings: null, whoami: null, loading: true, error: null, live: false, lastUpdated: null };

export function useGuardian(pollMs = 30_000) {
  const [state, setState] = useState<GuardianState>(EMPTY);
  const [session, setSessionState] = useState<Session>(() => loadSession());
  const inflight = useRef<Promise<void> | null>(null);
  const debounce = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const [monitors, incidents, proposals, audit, overview, settings, whoami] = await Promise.all([guardian.monitors.list(), guardian.incidents.list(), guardian.proposals.list(), guardian.audit.list(), guardian.overview(), guardian.settings(), guardian.whoami()]);
        setState((s) => ({ ...s, monitors, incidents, proposals, audit, overview, settings, whoami, loading: false, error: null, lastUpdated: Date.now() }));
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: describeError(err) }));
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void refresh(), 250);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const stop = subscribeEvents(
      () => scheduleRefresh(),
      (connected) => setState((s) => (s.live === connected ? s : { ...s, live: connected })),
    );
    const poll = window.setInterval(() => void refresh(), pollMs);
    const off = onSessionChange(() => {
      setSessionState(loadSession());
      scheduleRefresh();
    });
    return () => {
      stop();
      window.clearInterval(poll);
      off();
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [refresh, scheduleRefresh, pollMs]);

  const setSession = useCallback((s: Session) => saveSession(s), []);
  const actor = session.actor || state.settings?.profile.name || 'operator';
  const canOperate = state.whoami ? state.whoami.role === 'operator' : false;

  return useMemo(() => ({ ...state, session, actor, canOperate, refresh, setSession }), [state, session, actor, canOperate, refresh, setSession]);
}
export type GuardianStore = ReturnType<typeof useGuardian>;
