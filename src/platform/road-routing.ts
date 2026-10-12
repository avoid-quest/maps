import type { RoadRoutingTransport } from './road-routing.types';

// Tests and platforms without the Android adapter retain the bounded JavaScript transport.
export const nativeRoadRouting: RoadRoutingTransport | null = null;
