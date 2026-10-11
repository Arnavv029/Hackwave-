import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

/**
 * In-process event bus with a Server-Sent Events endpoint so the dashboard
 * updates the moment a check finishes, an incident opens or a proposal moves.
 */
export type GuardianEventType =
  | 'monitor.created'
  | 'monitor.updated'
  | 'monitor.deleted'
  | 'check.completed'
  | 'baseline.created'
  | 'baseline.approved'
  | 'incident.opened'
  | 'incident.updated'
  | 'incident.resolved'
  | 'proposal.created'
  | 'proposal.updated'
  | 'settings.updated'
  | 'mapping.changed';

export interface GuardianEvent {
  type: GuardianEventType;
  at: string;
  /** Small, secret-free payload; clients refetch what they need. */
  data: Record<string, unknown>;
}

export class GuardianEvents {
  private readonly emitter = new EventEmitter();
  private seq = 0;
  constructor() {
    this.emitter.setMaxListeners(1_000);
  }
  emit(type: GuardianEventType, data: Record<string, unknown> = {}): void {
    const ev: GuardianEvent = { type, at: new Date().toISOString(), data };
    this.emitter.emit('event', ev, ++this.seq);
  }
  subscribe(fn: (ev: GuardianEvent, id: number) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
  /** Express handler streaming events as SSE with a heartbeat. */
  sseHandler(heartbeatMs = 15_000) {
    return (req: Request, res: Response): void => {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      const unsubscribe = this.subscribe((ev, id) => {
        res.write(`id: ${id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      });
      const beat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), heartbeatMs);
      const close = (): void => {
        clearInterval(beat);
        unsubscribe();
        if (!res.writableEnded) res.end();
      };
      req.on('close', close);
      req.on('error', close);
    };
  }
}
