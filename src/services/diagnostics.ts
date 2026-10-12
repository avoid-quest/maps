/** Local diagnostics deliberately have no free-text field, URL, location or identifier. */
export const DIAGNOSTICS_KEY = '@avoid-maps/diagnostics-v1';
export const MAX_DIAGNOSTIC_EVENTS = 120;
export const MAX_DIAGNOSTIC_BYTES = 32 * 1024;

const states = {
  app: ['launch', 'active', 'background', 'inactive', 'unknown', 'runtime-error'],
  map: ['loaded', 'failed'],
  location: ['requested', 'approximate', 'precise', 'granted', 'denied', 'fix', 'timeout', 'unavailable'],
  navigation: ['start-requested', 'active', 'degraded', 'off-route', 'rerouting', 'arrived', 'stopped', 'interrupted', 'denied', 'engine-unavailable', 'service-unavailable', 'route-unavailable', 'rate-limit', 'reroute-limit', 'transit-replan-needed', 'native-error'],
  favorites: ['read-failed', 'write-failed'],
  'saved-travel': ['read-failed', 'write-failed', 'remove-failed', 'invalid'],
  clipboard: ['copied', 'failed'],
  service: ['invalid', 'unavailable', 'network', 'rate-limit'],
  request: ['ok', 'network', 'timeout', 'cancelled', 'rate-limit', 'unavailable', 'invalid'],
} as const;
const providers = ['photon', 'fossgis', 'mato', 'gtt-arrivals', 'gtt-alerts', 'other'] as const;
export type DiagnosticProvider = (typeof providers)[number];
export type DiagnosticInput = {
  [K in keyof typeof states]: { type: K; state: (typeof states)[K][number] }
}[keyof typeof states] & { provider?: DiagnosticProvider; durationMs?: number; httpStatus?: number };
export type DiagnosticEvent = DiagnosticInput & { at: number };
export interface DiagnosticStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
}
export interface DiagnosticSnapshot {
  ready: boolean;
  preferenceKnown: boolean;
  enabled: boolean;
  storage: 'memory' | 'local' | 'unavailable';
  events: readonly DiagnosticEvent[];
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const timestamp = (value: unknown): value is number => integer(value, 946684800000, 4102444800000);

/** Rebuild from individual allowlisted fields, including after loading untrusted storage. */
function sanitizeEvent(value: unknown, at?: number): DiagnosticEvent | undefined {
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(states, value.type)) return;
  const type = value.type as keyof typeof states;
  if (!(states[type] as readonly unknown[]).includes(value.state)) return;
  const eventAt = at ?? value.at;
  if (!timestamp(eventAt)) return;
  const clean = { at: eventAt, type, state: value.state } as DiagnosticEvent;
  if (type === 'request' || type === 'service') {
    clean.provider = (providers as readonly unknown[]).includes(value.provider) ? value.provider as DiagnosticProvider : 'other';
  }
  if (type === 'request') {
    if (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)) clean.durationMs = Math.round(Math.max(0, Math.min(value.durationMs, 120_000)) / 10) * 10;
    if (integer(value.httpStatus, 100, 599)) clean.httpStatus = value.httpStatus;
  }
  return clean;
}

function bounded(events: readonly unknown[]): DiagnosticEvent[] {
  const clean = events.slice(-MAX_DIAGNOSTIC_EVENTS).flatMap(value => {
    const event = sanitizeEvent(value); return event ? [event] : [];
  });
  // All serialized fields are ASCII; reserve room for the enclosing storage object.
  while (JSON.stringify(clean).length > MAX_DIAGNOSTIC_BYTES - 128) clean.shift();
  return clean;
}

export function createDiagnostics(now = Date.now) {
  let snapshot: DiagnosticSnapshot = { ready: false, preferenceKnown: false, enabled: true, storage: 'memory', events: [] };
  let storage: DiagnosticStorage | undefined;
  let initialization: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  let clearedBeforeReady = false;
  let enabledBeforeReady: boolean | undefined;
  let eventsBeforeChoice: readonly DiagnosticEvent[] = [];
  const listeners = new Set<() => void>();
  function update(next: Partial<DiagnosticSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => { try { listener(); } catch { /* Observers must not break application requests. */ } });
  }
  function persist() {
    if (!storage || !snapshot.ready || !snapshot.preferenceKnown) return;
    const target = storage;
    const serialized = JSON.stringify({ version: 1, enabled: snapshot.enabled, events: bounded(snapshot.events) });
    // Capture state now, serialize writes, and never propagate storage failure to a provider.
    writes = writes.then(async () => {
      try { await target.setItem(DIAGNOSTICS_KEY, serialized); if (snapshot.storage !== 'local') update({ storage: 'local' }); }
      catch { update({ storage: 'unavailable' }); }
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize(target: DiagnosticStorage): Promise<void> {
      if (initialization) return initialization;
      storage = target;
      initialization = (async () => {
        let loaded: unknown;
        let failed = false;
        try {
          const raw = await target.getItem(DIAGNOSTICS_KEY);
          if (raw && raw.length > MAX_DIAGNOSTIC_BYTES) throw new Error('Oversized diagnostic storage');
          loaded = raw === null ? undefined : JSON.parse(raw);
        } catch { failed = true; }
        const stored = record(loaded) && loaded.version === 1 && typeof loaded.enabled === 'boolean' && Array.isArray(loaded.events) ? loaded : undefined;
        if (loaded !== undefined && !stored) failed = true;
        const storedEnabled = stored ? stored.enabled as boolean : !failed;
        const enabled = enabledBeforeReady ?? storedEnabled;
        const previous = stored && !clearedBeforeReady ? bounded(stored.events as unknown[]) : [];
        // Startup events need the saved on switch; an explicit choice only authorizes later events.
        const pending = [
          ...(storedEnabled ? eventsBeforeChoice : []),
          ...(storedEnabled || enabledBeforeReady !== undefined ? snapshot.events : []),
        ];
        update({ ready: true, preferenceKnown: !failed || enabledBeforeReady !== undefined, enabled, events: bounded([...previous, ...pending]), storage: failed ? 'unavailable' : 'local' });
        eventsBeforeChoice = [];
        persist();
      })();
      return initialization;
    },
    record(input: DiagnosticInput) {
      if (!snapshot.enabled) return;
      const event = sanitizeEvent(input, now());
      if (!event) return;
      // A renderer can emit one error per missing tile. Keep state changes, not tile spam.
      if (event.type === 'map') {
        const previous = [...snapshot.events].reverse().find(item => item.type === 'map');
        if (previous?.state === event.state && event.at - previous.at < 30_000) return;
      }
      update({ events: bounded([...snapshot.events, event]) });
      persist();
    },
    async setEnabled(enabled: boolean) {
      if (!snapshot.ready) {
        if (enabledBeforeReady === undefined) {
          eventsBeforeChoice = snapshot.events;
          update({ events: [] });
        }
        enabledBeforeReady = enabled;
      }
      update({ enabled, preferenceKnown: true }); persist();
      await initialization; await writes;
      return snapshot.storage !== 'unavailable';
    },
    async clear() {
      if (!snapshot.ready) clearedBeforeReady = true;
      eventsBeforeChoice = [];
      update({ events: [] }); persist();
      await initialization; await writes;
      return snapshot.storage !== 'unavailable';
    },
    async flush() { await initialization; await writes; },
  };
}

export const diagnostics = createDiagnostics();

export interface DiagnosticMetadata {
  version?: unknown;
  build?: unknown;
  revision?: unknown;
  platform?: unknown;
  osVersion?: unknown;
  gttVersion?: unknown;
  gttValidTo?: unknown;
  placesRelease?: unknown;
}
export function createDiagnosticReport(snapshot: DiagnosticSnapshot, metadata: DiagnosticMetadata, now = Date.now()): string {
  // Metadata comes from the compiled Expo config and generic platform fields only.
  const version = typeof metadata.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(metadata.version) ? metadata.version : 'unknown';
  const revision = typeof metadata.revision === 'string' && /^[a-f0-9]{40}$/.test(metadata.revision) ? metadata.revision : 'development';
  const platform = typeof metadata.platform === 'string' && ['android', 'ios', 'web'].includes(metadata.platform) ? metadata.platform : 'unknown';
  const osVersion = integer(metadata.osVersion, 1, 999) ? metadata.osVersion : 'unknown';
  const build = integer(metadata.build, 1, 999999999) ? metadata.build : 'unknown';
  const dateId = (value: unknown) => typeof value === 'string' && /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(value) ? value : 'unknown';
  const placesRelease = typeof metadata.placesRelease === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.\d{1,3}$/.test(metadata.placesRelease) ? metadata.placesRelease : 'unknown';
  const events = bounded(snapshot.events);
  const lines = events.map(event => {
    const fields = [new Date(event.at).toISOString(), `${event.type}.${event.state}`];
    if (event.provider) fields.push(`provider=${event.provider}`);
    if (event.durationMs !== undefined) fields.push(`durationMs=${event.durationMs}`);
    if (event.httpStatus !== undefined) fields.push(`http=${event.httpStatus}`);
    return fields.join(' ');
  });
  return [
    'Avoid Maps — diagnostica locale v1',
    `App: ${version} | build: ${build} | revision: ${revision}`,
    `Platform: ${platform} | OS API/version: ${osVersion}`,
    `Bundled data: GTT ${dateId(metadata.gttVersion)} validTo=${dateId(metadata.gttValidTo)} | Overture ${placesRelease}`,
    `Created: ${timestamp(now) ? new Date(now).toISOString() : 'unknown'}`,
    `Recording: ${snapshot.enabled === true ? 'enabled' : 'disabled'} | storage: ${snapshot.storage === 'local' ? 'local' : snapshot.storage === 'memory' ? 'memory' : 'unavailable'}`,
    `Events: ${events.length}/${MAX_DIAGNOSTIC_EVENTS} (oldest first)`,
    'No coordinates, searches, place names, URLs, identifiers or raw errors. No automatic upload.',
    'HTTP ok means response received; it does not establish valid or fresh provider data.',
    'Native crashes and errors before JavaScript starts are not captured. Fatal events may not reach storage.',
    '', ...lines,
  ].join('\n');
}

export async function copyDiagnosticReport(report: string, write: (text: string) => Promise<boolean | void>): Promise<'copied' | 'failed'> {
  try { return await write(report) === false ? 'failed' : 'copied'; } catch { return 'failed'; }
}

type ErrorHandler = (error: Error, isFatal?: boolean) => void;
interface ErrorHooks { getGlobalHandler(): ErrorHandler; setGlobalHandler(handler: ErrorHandler): void }
/** Do not inspect the exception; keep React Native's original fatal/error behavior. */
export function observeUnexpectedErrors(hooks: ErrorHooks | undefined, log = diagnostics.record): () => void {
  if (!hooks) return () => {};
  const original = hooks.getGlobalHandler();
  const handler: ErrorHandler = (error, fatal) => {
    try { log({ type: 'app', state: 'runtime-error' }); } catch { /* Diagnostics must not replace the original handler. */ }
    original(error, fatal);
  };
  hooks.setGlobalHandler(handler);
  return () => { if (hooks.getGlobalHandler() === handler) hooks.setGlobalHandler(original); };
}
