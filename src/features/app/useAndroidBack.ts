import { useEffect, useLayoutEffect, useRef } from 'react';
import { Alert, BackHandler, Keyboard } from 'react-native';
import type { DeviceLocation } from '../map/useDeviceLocation';
import type { NavigationModel } from '../navigation/useNavigation';
import type { Search } from '../search/useSearch';
import type { SheetState } from './sheet';
import { defaultSnap, resolveSnap, sheetBackStep } from './sheet-model';
import { hasTaskAboveRoot, topTask } from './task-model';
import type { TaskModel } from './useTaskModel';

/**
 * Android Back: dismiss the keyboard, then let active guidance confirm Stop, then lower a sheet the
 * user raised above its resting height, then unwind one task (see sheetBackStep).
 */
export function useAndroidBack(dependencies: {
  tasks: TaskModel; navigation: NavigationModel; sheet: SheetState; search: Search; location: DeviceLocation;
}) {
  const latest = useRef(dependencies);
  useLayoutEffect(() => { latest.current = dependencies; });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const { tasks, navigation, sheet, search, location } = latest.current;
      if (Keyboard.isVisible()) { Keyboard.dismiss(); return true; }
      if (navigation.back(stop => Alert.alert('Interrompere la navigazione?', 'Puoi continuare a seguire il percorso oppure interrompere la sessione.', [
        { text: 'Continua', style: 'cancel' },
        { text: 'Interrompi', style: 'destructive', onPress: stop },
      ], { cancelable: true }))) return true;
      const state = tasks.getState();
      const resting = defaultSnap(state, search.hasSearch);
      const step = sheetBackStep(state, resolveSnap(sheet.requested, resting), resting, sheet.heights.current);
      if (step === 'collapse') { sheet.collapse(); return true; }
      if (step === 'exit') return false;
      if (hasTaskAboveRoot(state)) {
        const top = topTask(state);
        if (top.kind === 'planner' && top.originStep !== 'picking') location.cancel();
        tasks.dispatch({ type: 'back' });
        return true;
      }
      if (state.root.kind === 'search') { Keyboard.dismiss(); search.clear(); }
      tasks.dispatch({ type: 'back' });
      return true;
    });
    return () => subscription.remove();
  }, []);
}
