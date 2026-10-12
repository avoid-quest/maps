import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { RoadRoutingTransport } from './road-routing.types';

const native = Platform.OS === 'android' ? requireOptionalNativeModule<RoadRoutingTransport>('AvoidNavigation') : null;
// An Android build without the module must not bypass the shared native provider queue.
export const nativeRoadRouting: RoadRoutingTransport | null = Platform.OS === 'android' ? {
  requestRoadRoute: (requestId, from, to, mode) => native?.requestRoadRoute(requestId, from, to, mode)
    ?? Promise.reject(Object.assign(new Error('Road routing unavailable'), { code: 'unavailable' })),
  cancelRoadRoute: requestId => native?.cancelRoadRoute(requestId),
} : null;
