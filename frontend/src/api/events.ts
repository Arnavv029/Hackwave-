/** Server-Sent Events subscription with automatic reconnect. */
export interface LiveEvent {
  type: string;
  at: string;
  data: Record<string, unknown>;
}
export function subscribeEvents(onEvent: (ev: LiveEvent) => void, onState: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 1000;
  const open = (): void => {
    if (closed) return;
    es = new EventSource('/api/events');
    es.onopen = () => {
      retry = 1000;
      onState(true);
    };
    es.onmessage = (m) => handle(m);
    for (const t of ['monitor.created', 'monitor.updated', 'monitor.deleted', 'check.completed', 'baseline.created', 'baseline.approved', 'incident.opened', 'incident.updated', 'incident.resolved', 'proposal.created', 'proposal.updated', 'settings.updated', 'mapping.changed']) {
      es.addEventListener(t, (m) => handle(m as MessageEvent));
    }
    es.onerror = () => {
      onState(false);
      es?.close();
      es = null;
      if (!closed) {
        window.setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      }
    };
  };
  const handle = (m: MessageEvent): void => {
    try {
      const parsed = JSON.parse(String(m.data)) as LiveEvent;
      if (parsed && typeof parsed.type === 'string') onEvent(parsed);
    } catch {
      /* heartbeat or malformed */
    }
  };
  open();
  return () => {
    closed = true;
    es?.close();
    onState(false);
  };
}
