import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import type { NavigationPlatform, NavigationSnapshot, NavigationStart, TransitConfirmation, TransitNavigationStart } from '../domain/navigation';
import { idleNavigation } from '../domain/navigation';

interface NativeNavigation {
  startNavigation(options: NavigationStart): Promise<NavigationSnapshot>;
  startTransitNavigation(options: TransitNavigationStart): Promise<NavigationSnapshot>;
  confirmTransitStep(sessionId: string, action: TransitConfirmation): Promise<NavigationSnapshot>;
  stopNavigation(sessionId: string | null): Promise<NavigationSnapshot>;
  retryNavigation(sessionId: string): Promise<NavigationSnapshot>;
  setMuted(sessionId: string, muted: boolean): Promise<NavigationSnapshot>;
  getSnapshot(): Promise<NavigationSnapshot>;
  addListener(event: 'onNavigationState', listener: (snapshot: NavigationSnapshot) => void): { remove(): void };
}
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeNavigation>('AvoidNavigation') : null;
const unavailable = () => Promise.reject(new Error('navigation-unavailable'));
export const navigationPlatform: NavigationPlatform = {
  supported: native !== null,
  async prepareStart() {
    if (!native) throw new Error('navigation-unavailable');
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    if (result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('location-permission');
    if (Number(Platform.Version) >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  },
  startNavigation: options => native?.startNavigation(options) ?? unavailable(),
  startTransitNavigation: options => native?.startTransitNavigation(options) ?? unavailable(),
  confirmTransitStep: (sessionId, action) => native?.confirmTransitStep(sessionId, action) ?? unavailable(),
  stopNavigation: sessionId => native?.stopNavigation(sessionId) ?? Promise.resolve(idleNavigation),
  retryNavigation: sessionId => native?.retryNavigation(sessionId) ?? unavailable(),
  setMuted: (sessionId, muted) => native?.setMuted(sessionId, muted) ?? unavailable(),
  getSnapshot: () => native?.getSnapshot() ?? Promise.resolve(idleNavigation),
  subscribe: listener => {
    const subscription = native?.addListener('onNavigationState', listener);
    return () => subscription?.remove();
  },
};
