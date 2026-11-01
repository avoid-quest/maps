import type { TravelMode } from '../../domain/types';
import type { IconName } from '../../ui';

export const TRAVEL_MODES: { id: TravelMode; label: string; icon: IconName }[] = [
  { id: 'walk', label: 'A piedi', icon: 'walk-outline' },
  { id: 'bicycle', label: 'Bici', icon: 'bicycle-outline' },
  { id: 'car', label: 'Auto', icon: 'car-outline' },
  { id: 'transit', label: 'Mezzi', icon: 'bus-outline' },
];
