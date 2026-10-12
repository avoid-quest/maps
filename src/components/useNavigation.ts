import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { navigationPlatform } from '../platform/navigation';
import { createNavigationController } from './navigation-controller';
import { navigationVisible } from '../domain/navigation';
import { diagnostics } from '../services/diagnostics';

export function useNavigation(active: boolean) {
  const [controller] = useState(() => createNavigationController(navigationPlatform, state => diagnostics.record({ type: 'navigation', state })));
  const wasActive = useRef(active);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => controller.connect(), [controller]);
  useEffect(() => { if (active && !wasActive.current) void controller.refresh(); wasActive.current = active; }, [active, controller]);
  return { ...state, supported: controller.supported, visible: state.busy === 'start' || state.busy === 'stop' || navigationVisible(state.snapshot),
    start: controller.start, startTransit: controller.startTransit, stop: controller.stop, back: controller.back, retry: controller.retry, toggleMuted: controller.toggleMuted, confirmTransit: controller.confirmTransit };
}
