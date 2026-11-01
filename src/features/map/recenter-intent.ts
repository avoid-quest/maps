/**
 * An explicit Locate must centre the camera on the first fix it produces, even when Android's
 * permission dialog backgrounds the app and the original request is suspended: the fix then arrives
 * through the foreground acquisition that runs on return. Only a user choice (panning, opening a
 * place or stop, searching) withdraws the intent; app lifecycle does not.
 *
 * The intent is bounded: it ends when the request that armed it fails (even after being suspended,
 * e.g. permission denied in the dialog), when the resumed permission check finds no permission, and
 * after `maxAgeMs`, so a much later fix never moves the camera unexpectedly.
 */
export const RECENTER_MAX_AGE_MS = 90_000;

export function createRecenterIntent(maxAgeMs = RECENTER_MAX_AGE_MS) {
  let owner: number | null = null;
  let armedAt = 0;
  const live = (now: number) => owner !== null && now - armedAt <= maxAgeMs && now >= armedAt;
  return {
    /** Locate was pressed; `request` identifies the acquisition it started. */
    request(request: number, now: number) { owner = request; armedAt = now; },
    /** The user chose another view or task; a later fix must not move the camera. */
    withdraw() { owner = null; },
    /** An acquisition failed. Only the request that armed the intent (or a newer one) ends it. */
    failed(request: number) { if (owner !== null && request >= owner) owner = null; },
    /** The foreground permission check after resuming found no permission: nothing will arrive. */
    notAuthorized() { owner = null; },
    /** A fix arrived from any request. `center` consumes the intent. */
    take(now: number): 'center' | 'adopt' {
      const center = live(now);
      owner = null;
      return center ? 'center' : 'adopt';
    },
    pending(now: number) { return live(now); },
  };
}
