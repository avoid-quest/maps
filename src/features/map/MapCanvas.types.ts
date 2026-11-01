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
  /** Forces an explicit recenter even when the last commanded coordinate is unchanged. */
  cameraRevision?: number;
  /** A user-requested planning frame; refreshed geometry with the same key never moves the camera. */
  routeFitKey?: string;
  attributionTop?: number;
  attributionLeft?: number;
  cameraPadding?: { top: number; right: number; bottom: number; left: number };
  markers?: MapMarker[];
  selectedMarkerId?: string;
  route?: LineString | null;
  coverageBounds?: [west: number, south: number, east: number, north: number];
  userLocation?: MapCoordinate | null;
  /** Undefined fits planning routes; false leaves an active journey camera under user control. */
  followLocation?: boolean;
  onPressMarker?: (id: string) => void;
  onMapPress?: (coordinate: MapCoordinate) => void;
  /**
   * Frame these bounds once per key, with the current camera padding (submitted search results).
   * A user pan consumes a pending frame; `ready` false defers it until results settle.
   */
  resultFrame?: { key: string; bounds: [west: number, south: number, east: number, north: number] | null; ready: boolean };
  /** Every settled camera change, user-driven or programmatic: the centre and zoom now shown. */
  onViewChanged?: (center: MapCoordinate, zoom: number) => void;
  /** A user-driven camera change: the new centre and zoom. */
  onRegionChanged?: (center: MapCoordinate, zoom: number) => void;
}
