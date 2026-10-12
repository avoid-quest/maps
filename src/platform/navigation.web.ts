import type { NavigationPlatform } from '../domain/navigation';
import { idleNavigation } from '../domain/navigation';

const unavailable = () => Promise.reject(new Error('navigation-unavailable'));
export const navigationPlatform: NavigationPlatform = {
  supported: false,
  prepareStart: unavailable,
  startNavigation: unavailable,
  startTransitNavigation: unavailable,
  confirmTransitStep: unavailable,
  stopNavigation: async () => idleNavigation,
  retryNavigation: unavailable,
  setMuted: unavailable,
  getSnapshot: async () => idleNavigation,
  subscribe: () => () => {},
};
