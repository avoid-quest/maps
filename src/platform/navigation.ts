import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import type { NavigationPlatform, NavigationSnapshot, NavigationStart, TransitConfirmation, TransitNavigationStart } from '../domain/navigation';
import { idleNavigation } from '../domain/navigation';
import { nativeRoadStart, nativeTransitStart } from '../domain/navigation-payload';

interface NativeNavigation {
  startNavigation(options: ReturnType<typeof nativeRoadStart>): Promise<NavigationSnapshot>;
  startTransitNavigation(options: ReturnType<typeof nativeTransitStart>): Promise<NavigationSnapshot>;
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
  // Explicit, bridge-safe payloads: the native bridge rejects nested undefined/null before Kotlin runs.
  startNavigation: async (options: NavigationStart) => native ? native.startNavigation(nativeRoadStart(options)) : unavailable(),
  startTransitNavigation: async (options: TransitNavigationStart) => native ? native.startTransitNavigation(nativeTransitStart(options)) : unavailable(),
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
