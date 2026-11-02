import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard } from 'react-native';
import { createFeatureContext } from './feature-context';
import { dismissesKeyboard, type SheetHeights, type SheetSnap } from './sheet-model';

export interface SheetState {
  /** A height the user chose by dragging or the expand control; null rests at the task's default. */
  requested: SheetSnap | null;
  /**
   * Records a height reached by gesture or chosen with the explicit controls. Only `explicit`
   * requests (the header control) dismiss the keyboard when expanding to full.
   */
  request(snap: SheetSnap, options?: { explicit?: boolean }): void;
  /** Returns to the task's resting height. */
  collapse(): void;
  /** The heights currently laid out (set by the shell), for Back decisions outside rendering. */
  heights: RefObject<SheetHeights | null>;
}

/** Sheet height intent; a different task (see detailKey) starts at its resting height. */
export function useSheetState(contentKey: string): SheetState {
  const [requested, setRequested] = useState<SheetSnap | null>(null);
  useEffect(() => { setRequested(null); }, [contentKey]);
  const collapse = useCallback(() => setRequested(null), []);
  const current = useRef<SheetSnap | null>(null);
  current.current = requested;
  const request = useCallback((snap: SheetSnap, options?: { explicit?: boolean }) => {
    // Side effect outside the updater: React may run updaters during render, or twice in StrictMode.
    if (dismissesKeyboard(current.current, snap, options?.explicit ?? false)) Keyboard.dismiss();
    current.current = snap;
    setRequested(snap);
  }, []);
  const heights = useRef<SheetHeights | null>(null);
  return { requested, request, collapse, heights };
}

export const [SheetProvider, useSheet] = createFeatureContext<SheetState>('Sheet');
