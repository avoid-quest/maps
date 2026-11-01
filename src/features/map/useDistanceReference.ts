import { useMemo } from 'react';
import { useNow } from '../app/useNow';
import { distanceReference, type DistanceReference } from './distance-reference';
import { useMapContext } from './useMapModel';

/** The reference for list distances: the device when its fix is fresh, else the searched map centre. */
export function useDistanceReference(): DistanceReference {
  const { location, camera } = useMapContext();
  const now = useNow();
  const { coordinate, fixedAt } = location;
  const { searchCenter } = camera;
  return useMemo(() => distanceReference({ device: coordinate, fixedAt, now, mapCenter: searchCenter }), [coordinate, fixedAt, now, searchCenter]);
}
