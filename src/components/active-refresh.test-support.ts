/** Deterministic scheduler timing: no real timers, requests or persistence. */
import type { RefreshTiming } from './active-refresh';

export class FakeClock implements RefreshTiming {
  mono = 0;
  wall = Date.parse('2026-10-12T08:00:00Z');
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();
  monotonicNow = () => this.mono;
  wallNow = () => this.wall;
  setTimer = (callback: () => void, delayMs: number) => {
    const id = this.nextId++; this.timers.set(id, { at: this.mono + delayMs, callback }); return id;
  };
  clearTimer = (handle: unknown) => { this.timers.delete(handle as number); };
  get timerCount() { return this.timers.size; }
  get nextDue() { return Math.min(...[...this.timers.values()].map(timer => timer.at)); }
  shiftWall(ms: number) { this.wall += ms; }
  /** Advance a sleeping/suspended process, then deliver each already-due callback once. */
  jump(ms: number) { this.mono += ms; this.wall += ms; this.runDue(); }
  advance(ms: number) {
    const target = this.mono + ms;
    let count = 0;
    while (this.nextDue <= target) {
      if (++count > 1000) throw new Error('Timer loop');
      const next = this.nextDue; this.wall += next - this.mono; this.mono = next; this.runDue();
    }
    this.wall += target - this.mono; this.mono = target;
  }
  earlyWake(msBefore: number) {
    const entry = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!entry) throw new Error('No scheduled timer');
    const [id, timer] = entry;
    const at = timer.at - msBefore;
    if (at < this.mono) throw new Error('Cannot wake in the past');
    this.wall += at - this.mono; this.mono = at; this.timers.delete(id); timer.callback();
  }
  private runDue() {
    const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.mono);
    for (const [id, timer] of due) {
      if (!this.timers.delete(id)) continue;
      timer.callback();
    }
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
