import type { LineString } from 'geojson';
export type MapCoordinate = [number, number];
export interface MapMarker {
  id: string;
  coordinate: MapCoordinate;
  kind: 'place' | 'stop';
  label?: string;
}
export interface MapCanvasProps {
  center: MapCoordinate;
  zoom?: number;
  markers?: MapMarker[];
  selectedMarkerId?: string;
  route?: LineString | null;
  coverageBounds?: [west: number, south: number, east: number, north: number];
  userLocation?: MapCoordinate | null;
  /** Undefined fits planning routes; false leaves an active journey camera under user control. */
  followLocation?: boolean;
  onPressMarker?: (id: string) => void;
  onMapPress?: (coordinate: MapCoordinate) => void;
  onRegionChanged?: (center: MapCoordinate) => void;
}
