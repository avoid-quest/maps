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
  userLocation?: MapCoordinate | null;
  onPressMarker?: (id: string) => void;
  onMapPress?: (coordinate: MapCoordinate) => void;
  onRegionChanged?: (center: MapCoordinate) => void;
}
