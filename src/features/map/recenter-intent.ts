/**
 * An explicit Locate must centre the camera on the first fix it produces, even when Android's
 * permission dialog backgrounds the app and the original request is suspended: the fix then arrives
 * through the foreground acquisition that runs on return. Only a user choice (panning, opening a
 * place or stop, searching) withdraws the intent; app lifecycle does not.
 */
export function createRecenterIntent() {
  let pending = false;
  return {
    /** Locate was pressed. */
    request() { pending = true; },
    /** The user chose another view or task; a later fix must not move the camera. */
    withdraw() { pending = false; },
    /** The explicit request failed; nothing is left to centre on. */
    failed() { pending = false; },
    /** A fix arrived from any request. `center` consumes the intent. */
    take(): 'center' | 'adopt' {
      if (!pending) return 'adopt';
      pending = false;
      return 'center';
    },
    get pending() { return pending; },
  };
}
