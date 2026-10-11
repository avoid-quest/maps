export const REFRESH_INTERVALS = { arrivals: 60_000, alerts: 300_000, transit: 120_000 } as const;
const RATE_LIMIT_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const CACHE_RETRY_FLOOR_MS = 1_000;

export interface RefreshTiming {
  monotonicNow(): number;
  wallNow(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface RefreshResult<T> { value: T; fetchedAt: number }
export interface ActiveRefreshOptions<T> {
  /** null permits explicit requests only, including after failures and resume. */
  intervalMs: number | null;
  load(signal: AbortSignal): Promise<RefreshResult<T>>;
  onSuccess(value: T): void;
  onError(error: unknown): void;
  onLoadingChange?(loading: boolean): void;
  timing?: RefreshTiming;
}
export interface ActiveRefresh {
  setActive(active: boolean): void;
  refresh(): void;
  dispose(): void;
}
const defaultTiming: RefreshTiming = {
  monotonicNow: () => performance.now(),
  wallNow: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Owns one resource/query's in-memory request cadence, starting inactive and unarmed.
 * Keep it across activity changes; dispose on identity change or unmount. Restoring
 * a saved preview calls only setActive; explicit intent calls refresh to arm it.
 * Lifecycle handlers must deactivate synchronously, before yielding to React.
 * Provider queues still own cross-resource spacing, cooldown and cancellation.
 */
export function createActiveRefresh<T>(options: ActiveRefreshOptions<T>): ActiveRefresh {
  const timing = options.timing ?? defaultTiming;
  const interval = options.intervalMs;
  if (interval !== null && (!Number.isFinite(interval) || interval < CACHE_RETRY_FLOOR_MS || interval > MAX_BACKOFF_MS)) {
    throw new Error('Refresh interval must be null or between 1000 and 900000 ms');
  }
  let active = false;
  let armed = false;
  let disposed = false;
  let manualPending = false;
  let timer: unknown;
  let hasTimer = false;
  let generation = 0;
  let pollAt = 0;
  let retryAt = 0;
  let failures = 0;
  let latestFetchedAt: number | undefined;
  let loading = false;
  let inFlight: { abort: AbortController; generation: number } | undefined;

  function notify(callback: () => void) {
    try { callback(); } catch { /* Presentation errors must not become provider failures or prevent cleanup. */ }
  }
  function setLoading(next: boolean) {
    if (loading === next) return;
    loading = next;
    notify(() => options.onLoadingChange?.(next));
  }
  function clearTimer() {
    if (!hasTimer) return;
    timing.clearTimer(timer);
    hasTimer = false;
    timer = undefined;
  }
  function valid(request: NonNullable<typeof inFlight>) {
    return !disposed && active && request === inFlight && request.generation === generation && !request.abort.signal.aborted;
  }
  function pump() {
    clearTimer();
    if (disposed || !active || !armed || inFlight || (!manualPending && interval === null)) return;
    // Explicit refresh can bypass a successful poll's deadline, never retry cooldown.
    const deadline = manualPending ? retryAt : Math.max(pollAt, retryAt);
    const remaining = deadline - timing.monotonicNow();
    if (remaining > 0) {
      hasTimer = true;
      timer = timing.setTimer(() => {
        hasTimer = false;
        timer = undefined;
        pump();
      }, Math.ceil(remaining));
      return;
    }
    start();
  }
  function nextSuccessDeadline(result: RefreshResult<T>, completedAt: number) {
    if (interval === null) return completedAt;
    const fetchedAt = result.fetchedAt;
    const age = Number.isFinite(fetchedAt) ? Math.max(0, timing.wallNow() - fetchedAt) : Infinity;
    const unchanged = latestFetchedAt !== undefined && fetchedAt <= latestFetchedAt;
    const remaining = interval - age;
    // Preserve a first cache hit's remaining cadence. Unchanged, overdue or invalid
    // retrieval times wait a full interval, so old cache entries cannot spin.
    const delay = unchanged || !Number.isFinite(remaining) || remaining <= 0
      ? interval : Math.max(CACHE_RETRY_FLOOR_MS, remaining);
    if (Number.isFinite(fetchedAt)) latestFetchedAt = Math.max(latestFetchedAt ?? -Infinity, fetchedAt);
    return completedAt + delay;
  }
  function start() {
    if (disposed || !active || inFlight) return;
    const request = { abort: new AbortController(), generation };
    inFlight = request;
    manualPending = false;
    // An interrupted request retains a bounded deadline across quick hide/resume.
    if (interval !== null) pollAt = timing.monotonicNow() + interval;
    setLoading(true);
    void (async () => {
      try {
        // A loading callback may have deactivated us synchronously above.
        if (!valid(request)) return;
        const result = await options.load(request.abort.signal);
        if (!valid(request)) return;
        failures = 0;
        retryAt = 0;
        pollAt = nextSuccessDeadline(result, timing.monotonicNow());
        notify(() => options.onSuccess(result.value));
      } catch (error) {
        if (!valid(request)) return;
        failures = Math.min(failures + 1, 20);
        const base = interval ?? RATE_LIMIT_MS;
        const rateLimited = typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'rate-limit';
        const delay = Math.max(rateLimited ? RATE_LIMIT_MS : 0, Math.min(MAX_BACKOFF_MS, base * 2 ** (failures - 1)));
        retryAt = timing.monotonicNow() + delay;
        pollAt = retryAt;
        notify(() => options.onError(error));
      } finally {
        // Even an abort-ignoring promise occupies this slot until it settles.
        if (inFlight === request) inFlight = undefined;
        setLoading(false);
        pump();
      }
    })();
  }
  return {
    setActive(next) {
      if (disposed || active === next) return;
      active = next;
      if (!next) {
        generation++;
        manualPending = false;
        clearTimer();
        inFlight?.abort.abort();
        setLoading(false);
      } else pump();
    },
    refresh() {
      if (disposed) return;
      armed = true;
      // A valid pending request satisfies repeated taps. An aborted request still
      // holds the slot, but a new explicit intent can wait for its settlement.
      if (inFlight && !inFlight.abort.signal.aborted) return;
      manualPending = true;
      pump();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      generation++;
      manualPending = false;
      clearTimer();
      inFlight?.abort.abort();
      setLoading(false);
    },
  };
}
