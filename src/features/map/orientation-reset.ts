/**
 * The browsing map returns to north-up and flat after guidance. Several browse commands can race
 * when guidance closes (padding re-centre, follow ease, route fit); some are skipped because a newer
 * command superseded them. The reset therefore stays armed until a command that is actually issued
 * carries it, and only a user gesture (a deliberate view) cancels it.
 */
export function createOrientationReset() {
  let armed = false;
  return {
    arm() { armed = true; },
    get armed() { return armed; },
    /** A user gesture chose the view: no reset is applied any more. */
    userMoved() { armed = false; },
    /** Adds the north-up, flat pose to the command being issued, once. */
    apply<T extends object>(options: T): T & { bearing?: number; pitch?: number } {
      if (!armed) return options;
      armed = false;
      return { ...options, bearing: 0, pitch: 0 };
    },
  };
}
