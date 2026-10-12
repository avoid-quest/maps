import { idleNavigation, navigationVisible, type NavigationPlatform, type NavigationSnapshot, type NavigationStart, type TransitConfirmation, type TransitNavigationStart } from '../domain/navigation';
import type { DiagnosticInput } from '../services/diagnostics';

type NavigationDiagnostic = Extract<DiagnosticInput, { type: 'navigation' }>['state'];
const diagnosticStatuses: Partial<Record<NavigationSnapshot['status'], NavigationDiagnostic>> = {
  navigating: 'active', 'location-degraded': 'degraded', 'off-route': 'off-route', rerouting: 'rerouting', arrived: 'arrived', stopped: 'stopped', interrupted: 'interrupted',
};
const diagnosticProblems: Partial<Record<NonNullable<NavigationSnapshot['problem']>, NavigationDiagnostic>> = {
  'location-permission': 'denied', 'engine-unavailable': 'engine-unavailable', 'service-unavailable': 'service-unavailable',
  'route-unavailable': 'route-unavailable', 'rate-limit': 'rate-limit', 'reroute-limit': 'reroute-limit', 'transit-replan-needed': 'transit-replan-needed', 'native-error': 'native-error',
};
const unavailableStateMessage = 'Stato della navigazione non disponibile. Riapri l’app per controllarlo.';
function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.message : '';
}

export interface NavigationState {
  snapshot: NavigationSnapshot;
  ready: boolean;
  busy: 'start' | 'stop' | 'retry' | 'confirm' | null;
  error: string | null;
}
function failureMessage(error: unknown): string {
  if (errorCode(error) === 'location-permission') return 'Per avviare serve la posizione precisa. Abilitala nelle impostazioni dell’app e riprova.';
  if (errorCode(error) === 'navigation-unavailable') return 'La navigazione richiede la versione Android con il modulo di navigazione.';
  if (errorCode(error) === 'engine-unavailable') return 'Il motore di navigazione non è disponibile. Interrompi la sessione e riapri l’app.';
  if (errorCode(error) === 'service-unavailable') return 'Android non ha avviato il servizio di navigazione. Mantieni l’app visibile e riprova.';
  return 'Operazione non riuscita. Controlla lo stato della navigazione e riprova.';
}
/** Commands and native events meet here, including events arriving before command responses. */
export function createNavigationController(platform: NavigationPlatform, record: (state: NavigationDiagnostic) => void = () => {}) {
  let state: NavigationState = { snapshot: idleNavigation, ready: !platform.supported, busy: null, error: null };
  let operation = 0;
  let attachment = 0;
  let pendingStart: { submitted: boolean; previousSessionId: string | null } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: NavigationState) => { state = next; for (const listener of listeners) listener(); };
  const accept = (snapshot: NavigationSnapshot) => {
    if (!Number.isFinite(snapshot.revision)) return;
    // Location ticks carry the same geometry. Keep its object identity for native map layers.
    const previous = state.snapshot;
    const sameRoute = snapshot.sessionId === previous.sessionId && snapshot.routeRevision !== undefined && snapshot.routeRevision === previous.routeRevision;
    if (snapshot.revision < previous.revision) {
      // A full initial read may finish after the first location event carrying only the route revision.
      if (sameRoute && previous.route === undefined && snapshot.route && !['idle', 'stopped', 'arrived', 'interrupted', 'error'].includes(previous.status)) publish({ ...state, snapshot: { ...previous, route: snapshot.route } });
      return;
    }
    const status = diagnosticStatuses[snapshot.status];
    const problem = snapshot.problem ? diagnosticProblems[snapshot.problem] : undefined;
    if (status && snapshot.status !== previous.status) record(status);
    if (problem && snapshot.problem !== previous.problem) record(problem);
    const keepRoute = sameRoute && !['idle', 'stopped', 'arrived', 'interrupted', 'error'].includes(snapshot.status);
    if (keepRoute && !Object.hasOwn(snapshot, 'route')) snapshot = { ...snapshot, route: previous.route };
    else if (snapshot.route && previous.route && sameRoute) snapshot = { ...snapshot, route: previous.route };
    publish({ ...state, snapshot, ready: true, error: state.error === unavailableStateMessage ? null : state.error });
  };
  const refresh = async () => {
    try { accept(await platform.getSnapshot()); }
    catch { record('service-unavailable'); publish({ ...state, ready: false, error: unavailableStateMessage }); }
  };
  const command = async (kind: NavigationState['busy'], action: (current: () => boolean) => Promise<NavigationSnapshot | undefined>) => {
    const id = ++operation;
    publish({ ...state, busy: kind, error: null });
    try { const snapshot = await action(() => operation === id); if (snapshot && operation === id) accept(snapshot); }
    catch (error) {
      if (operation === id) {
        const code = errorCode(error);
        record(code === 'location-permission' ? 'denied' : code === 'navigation-unavailable' || code === 'service-unavailable' ? 'service-unavailable' : code === 'engine-unavailable' ? 'engine-unavailable' : 'native-error');
        publish({ ...state, error: failureMessage(error) });
      }
    }
    finally { if (operation === id) publish({ ...state, busy: null }); }
  };
  const start = (action: () => Promise<NavigationSnapshot>) => {
    if (!state.ready || state.busy || navigationVisible(state.snapshot)) return Promise.resolve();
    record('start-requested');
    const pending = { submitted: false, previousSessionId: state.snapshot.sessionId };
    pendingStart = pending;
    return command('start', async current => {
      try {
        await platform.prepareStart();
        if (!current()) return undefined;
        pending.submitted = true;
        return await action();
      } finally { if (pendingStart === pending) pendingStart = null; }
    });
  };
  const stop = async () => {
    const permissionOnly = pendingStart?.submitted === false;
    const submittedWithoutSession = pendingStart?.submitted && state.snapshot.sessionId === pendingStart.previousSessionId;
    const sessionId = permissionOnly || submittedWithoutSession ? null : state.snapshot.sessionId;
    pendingStart = null;
    // Permission-only cancellation needs no native command. A wildcard is reserved for an
    // already submitted Start whose first session event/response has not reached JS yet.
    await command('stop', () => sessionId !== null || submittedWithoutSession ? platform.stopNavigation(sessionId) : Promise.resolve(undefined));
    return state.snapshot.status === 'stopped' || state.snapshot.status === 'idle';
  };
  return {
    supported: platform.supported,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      const id = ++attachment;
      const remove = platform.subscribe(snapshot => { if (attachment === id) accept(snapshot); });
      void refresh();
      return () => { if (attachment === id) attachment += 1; remove(); };
    },
    refresh,
    start: (options: NavigationStart) => start(() => platform.startNavigation(options)),
    startTransit: (options: TransitNavigationStart) => start(() => platform.startTransitNavigation(options)),
    stop,
    back(confirm: (stop: () => void) => void) {
      if (state.busy === 'stop') return true;
      if (state.busy === 'start' || ['arrived', 'error', 'interrupted'].includes(state.snapshot.status)) { void stop(); return true; }
      if (!navigationVisible(state.snapshot)) return false;
      const sessionId = state.snapshot.sessionId;
      const requestedOperation = operation;
      const requestedAttachment = attachment;
      confirm(() => {
        if (attachment === requestedAttachment && operation === requestedOperation && state.snapshot.sessionId === sessionId) void stop();
      });
      return true;
    },
    confirmTransit(action: TransitConfirmation) {
      const sessionId = state.snapshot.sessionId;
      if (!sessionId || state.snapshot.mode !== 'transit' || state.busy) return Promise.resolve();
      return command('confirm', () => platform.confirmTransitStep(sessionId, action));
    },
    retry() {
      const sessionId = state.snapshot.sessionId;
      if (!sessionId || !state.snapshot.canRetry || state.busy) return Promise.resolve();
      return command('retry', async current => {
        await platform.prepareStart();
        return current() ? platform.retryNavigation(sessionId) : undefined;
      });
    },
    toggleMuted() {
      const { sessionId, voice } = state.snapshot;
      if (!sessionId || state.busy) return Promise.resolve();
      return command(null, () => platform.setMuted(sessionId, voice !== 'muted'));
    },
  };
}
