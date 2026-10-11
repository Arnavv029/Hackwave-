import type { Logger } from '../logger.js';
import type { GuardianStore } from './store.js';

/**
 * Interval scheduler. Every tick it claims due ACTIVE monitors by pushing
 * their `nextRunAt` forward (so a slow check is never started twice) and runs
 * them with bounded concurrency. State lives in the database, so a restart
 * resumes where it left off.
 */
export interface SchedulerDeps {
  store: GuardianStore;
  runCheck: (monitorId: string, triggeredBy: string) => Promise<unknown>;
  logger: Logger;
  tickMs?: number;
  maxConcurrent?: number;
  now?: () => Date;
}

export class MonitorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  private ticking = false;
  private readonly tickMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => Date;
  constructor(private readonly deps: SchedulerDeps) {
    this.tickMs = deps.tickMs ?? 1_000;
    this.maxConcurrent = deps.maxConcurrent ?? 4;
    this.now = deps.now ?? (() => new Date());
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
    this.deps.logger.info({ tickMs: this.tickMs, maxConcurrent: this.maxConcurrent }, 'monitor scheduler started');
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  get active(): boolean {
    return this.timer !== null;
  }
  /** One scheduling pass; exposed for tests. Returns the number of checks started. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let started = 0;
    try {
      const slots = this.maxConcurrent - this.running;
      if (slots <= 0) return 0;
      const due = await this.deps.store.listDueMonitors(this.now(), slots);
      for (const m of due) {
        // Claim: move nextRunAt forward before running so concurrent ticks (or a slow check) skip it.
        await this.deps.store.updateMonitor(m.id, { nextRunAt: new Date(this.now().getTime() + m.intervalSec * 1_000) });
        this.running++;
        started++;
        void this.deps
          .runCheck(m.id, 'scheduler')
          .catch((err: unknown) => this.deps.logger.error({ err, monitorId: m.id }, 'scheduled check failed'))
          .finally(() => {
            this.running--;
          });
      }
    } catch (err) {
      this.deps.logger.error({ err }, 'scheduler tick failed');
    } finally {
      this.ticking = false;
    }
    return started;
  }
}
