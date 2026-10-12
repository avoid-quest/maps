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
    publish({ ...state, snapshot, ready: true });
  };
  const refresh = async () => {
    try { accept(await platform.getSnapshot()); }
    catch { record('service-unavailable'); publish({ ...state, ready: false, error: 'Stato della navigazione non disponibile. Riapri l’app per controllarlo.' }); }
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
    start(options: NavigationStart) {
      if (!state.ready || state.busy || navigationVisible(state.snapshot)) return Promise.resolve();
      record('start-requested');
      return command('start', async current => {
        await platform.prepareStart();
        return current() ? platform.startNavigation(options) : undefined;
      });
    },
    startTransit(options: TransitNavigationStart) {
      if (!state.ready || state.busy || navigationVisible(state.snapshot)) return Promise.resolve();
      record('start-requested');
      return command('start', async current => {
        await platform.prepareStart();
        return current() ? platform.startTransitNavigation(options) : undefined;
      });
    },
    async stop() {
      await command('stop', () => platform.stopNavigation(null));
      return state.snapshot.status === 'stopped' || state.snapshot.status === 'idle';
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
