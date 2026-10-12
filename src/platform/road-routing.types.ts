import type { Coordinate, TravelMode } from '../domain/types';

export type RoadMode = Exclude<TravelMode, 'transit'>;
export interface RoadRouteResponse { responseJson: string; fetchedAt: number }
/** Android previews share this transport's native queue with navigation and reroutes. */
export interface RoadRoutingTransport {
  requestRoadRoute(requestId: string, from: Coordinate, to: Coordinate, mode: RoadMode): Promise<RoadRouteResponse>;
  cancelRoadRoute(requestId: string): Promise<void> | void;
}
