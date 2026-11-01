import type { Coordinate } from '../../domain/types';
import { distanceMeters } from '../../services/geo';
import { formatDistance } from '../../ui/format';

/**
 * Where a listed distance is measured from. A fresh device fix is the natural reference; otherwise the
 * distance is from the centre the map currently shows and says so, because that can be far from the
 * user (the launch overview, a restored view, or a panned map). A single selected item centred on the
 * map shows a distance only from the device (see `detailDistance`).
 */
export type DistanceReference = { kind: 'device' | 'map'; coordinate: Coordinate };

/** A browsing fix older than this no longer describes where the user is for list distances. */
export const DISTANCE_FIX_MAX_AGE_MS = 5 * 60_000;

export function distanceReference({ device, fixedAt, now, mapCenter }: {
  device: Coordinate | null; fixedAt: number | null; now: number; mapCenter: Coordinate;
}): DistanceReference {
  const fresh = device && fixedAt !== null && now - fixedAt >= -60_000 && now - fixedAt <= DISTANCE_FIX_MAX_AGE_MS;
  return fresh ? { kind: 'device', coordinate: device } : { kind: 'map', coordinate: mapCenter };
}

/** `value` is the bare distance for a numeric column; `note` qualifies it when not measured from the device. */
export function distanceFrom(reference: DistanceReference, target: Coordinate): { meters: number; value: string; note: string | null; label: string; spoken: string } {
  const meters = distanceMeters(reference.coordinate, target);
  const value = formatDistance(meters);
  return reference.kind === 'device'
    ? { meters, value, note: null, label: value, spoken: `a ${value} da te` }
    : { meters, value, note: 'dal centro mappa', label: `${value} dal centro mappa`, spoken: `${value} dal centro della mappa` };
}

/** A detail view (one stop or place, usually centred on the map) shows a distance only from the device. */
export function detailDistance(reference: DistanceReference, target: Coordinate) {
  return reference.kind === 'device' ? distanceFrom(reference, target) : null;
}
