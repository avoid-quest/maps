import { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { createFeatureContext } from './feature-context';
import type { SheetSnap } from './sheet-model';

export interface SheetState {
  /** A height the user chose by dragging or the expand control; null rests at the task's default. */
  requested: SheetSnap | null;
  /** Records a height reached by gesture or chosen with the explicit controls. */
  request(snap: SheetSnap): void;
  /** Returns to the task's resting height. */
  collapse(): void;
}

/** Sheet height intent; a different task (see detailKey) starts at its resting height. */
export function useSheetState(contentKey: string): SheetState {
  const [requested, setRequested] = useState<SheetSnap | null>(null);
  useEffect(() => { setRequested(null); }, [contentKey]);
  const collapse = useCallback(() => setRequested(null), []);
  const request = useCallback((snap: SheetSnap) => {
    setRequested(current => {
      if (current !== snap && snap === 'full') Keyboard.dismiss();
      return snap;
    });
  }, []);
  return { requested, request, collapse };
}

export const [SheetProvider, useSheet] = createFeatureContext<SheetState>('Sheet');
