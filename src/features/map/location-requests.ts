import type { Coordinate } from '../../domain/types';
import { LocationError } from '../../platform/location-request';
import { createRecenterIntent } from './recenter-intent';

export type LocationOutcome = { coordinate: Coordinate } | { error: unknown };

const NOT_AUTHORIZED = 'Posizione non autorizzata. Puoi comunque cercare sulla mappa.';

interface Dependencies {
  locate(): Promise<Coordinate>;
  now(): number;
  record(coordinate: Coordinate): void;
  center(coordinate: Coordinate): void;
  adopt(coordinate: Coordinate): void;
  setLocating(locating: boolean): void;
  /** Ends a planner's `locating` step; not sent while a suspended Locate still waits for its fix. */
  cancelled(): void;
}

/**
 * Coordinates browsing-location requests. An explicit Locate owns its outcome until the first fix
 * it leads to, including one delivered by the foreground acquisition after Android's permission
 * dialog suspended the request; it resolves `null` only when a user choice or a newer request
 * superseded it, so a planner Locate can still settle its origin.
 */
export function createLocationRequests(deps: Dependencies, intent = createRecenterIntent()) {
  let request = 0;
  let owner: { id: number; resolve(outcome: LocationOutcome | null): void } | null = null;
  const settle = (outcome: LocationOutcome | null, id?: number) => {
    if (!owner || (id !== undefined && owner.id !== id)) return;
    const { resolve } = owner;
    owner = null;
    resolve(outcome);
  };
  /** A fix from any request centres the camera when Locate is still pending, else only adopts an untouched camera. */
  const place = (coordinate: Coordinate) => {
    if (intent.take(deps.now()) === 'center') deps.center(coordinate);
    else deps.adopt(coordinate);
  };
  const halt = (notify: boolean) => {
    request += 1;
    deps.setLocating(false);
    if (notify) deps.cancelled();
  };

  return {
    current: () => request,
    /** Lifecycle suspension: stops the request but keeps an explicit Locate's intent and outcome. */
    suspend() { halt(owner === null); },
    /** A user choice supersedes any pending request, including a planner origin request and a pending Locate centre. */
    cancel() {
      intent.withdraw();
      settle(null);
      halt(true);
    },
    async acquire(options?: { recenter?: boolean }): Promise<LocationOutcome | null> {
      const id = ++request;
      settle(null);
      deps.setLocating(true);
      if (!options?.recenter) {
        try {
          const next = await deps.locate();
          if (id !== request) return null;
          deps.record(next);
          return { coordinate: next };
        } catch (error) {
          return id === request ? { error } : null;
        } finally {
          if (id === request) deps.setLocating(false);
        }
      }
      intent.request(id, deps.now());
      const outcome = new Promise<LocationOutcome | null>(resolve => { owner = { id, resolve }; });
      void deps.locate().then(next => {
        // Suspended by the lifecycle (permission dialog) but not by the user: the fix still answers
        // Locate; `place` centres only while the bounded intent is still live.
        if (id !== request && owner?.id !== id) return;
        deps.record(next);
        place(next);
        settle({ coordinate: next }, id);
      }, (error: unknown) => {
        // A denial ends a pending Locate even after the dialog suspended the request; an interruption
        // by the lifecycle does not (the foreground acquisition on return still brings a fix).
        const denied = error instanceof LocationError && error.code === 'denied';
        if (id !== request && !denied) return;
        intent.failed(id);
        settle({ error }, id);
      }).finally(() => { if (id === request) deps.setLocating(false); });
      // Settles as soon as a user choice or newer request supersedes it, without waiting for the fix.
      return outcome;
    },
    /** The foreground acquisition that started at `startedAt` delivered a fix. */
    foregroundFix(coordinate: Coordinate, startedAt: number) {
      deps.record(coordinate);
      if (startedAt !== request) return;
      place(coordinate);
      settle({ coordinate });
    },
    /** The foreground check that started at `startedAt` found no permission or failed. */
    foregroundFailed(startedAt: number, error?: unknown) {
      if (startedAt !== request) return;
      intent.notAuthorized();
      settle({ error: error ?? new LocationError('denied', NOT_AUTHORIZED) });
    },
  };
}
