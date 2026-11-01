import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type ScrollView } from 'react-native';
import { createFeatureContext } from './feature-context';
import { plannerTask, searchRoot, selectedPlace, type TaskState } from './task-model';

export interface SheetState {
  /** The task card is expanded to the available height. */
  expanded: boolean;
  collapse(): void;
  toggle(): void;
  scrollRef: RefObject<ScrollView | null>;
}

/** Sheet geometry state; a different task (see detailKey) starts at the top, collapsed. */
export function useSheetState(contentKey: string): SheetState {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setExpanded(false);
  }, [contentKey]);
  const collapse = useCallback(() => setExpanded(false), []);
  const toggle = useCallback(() => { Keyboard.dismiss(); setExpanded(value => !value); }, []);
  return { expanded, collapse, toggle, scrollRef };
}

/** Compact heights are reserved per task so asynchronous content never moves the sheet. */
export function sheetHeight({ tasks, hasSearch, expanded, availableHeight, fontScale }: {
  tasks: TaskState; hasSearch: boolean; expanded: boolean; availableHeight: number; fontScale: number;
}): number {
  const search = searchRoot(tasks);
  const compact = plannerTask(tasks) ? 300 : search?.inputOpen && !hasSearch && !selectedPlace(tasks) ? 132 : 236;
  return Math.min(availableHeight - 136, expanded ? availableHeight - 136 : compact * Math.min(fontScale, 1.5));
}

export const [SheetProvider, useSheet] = createFeatureContext<SheetState>('Sheet');
