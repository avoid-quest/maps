import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createFeatureContext } from './feature-context';
import { initialTaskState, taskReducer, type TaskAction, type TaskState } from './task-model';

/** Runs synchronously inside dispatch, before React renders the next task. */
export type TaskTransitionListener = (previous: TaskState, next: TaskState) => void;
export interface TaskModel {
  state: TaskState;
  /** The state including transitions dispatched earlier in the current event. */
  getState(): TaskState;
  dispatch(action: TaskAction): void;
  subscribeTransitions(listener: TaskTransitionListener): () => void;
}

/**
 * Request controllers must stop before React renders a task that no longer wants
 * them. Transition listeners give features that synchronous hook without letting
 * them own task state.
 */
export function useTaskModel(): TaskModel {
  const [state, apply] = useReducer(taskReducer, initialTaskState);
  const current = useRef(state);
  const [listeners] = useState(() => new Set<TaskTransitionListener>());
  const dispatch = useCallback((action: TaskAction) => {
    const previous = current.current;
    const next = taskReducer(previous, action);
    if (next === previous) return;
    current.current = next;
    for (const listener of listeners) listener(previous, next);
    apply(action);
  }, [listeners]);
  const getState = useCallback(() => current.current, []);
  const subscribeTransitions = useCallback((listener: TaskTransitionListener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [listeners]);
  return { state, getState, dispatch, subscribeTransitions };
}

/** Subscribes the latest listener for the component's lifetime. */
export function useTaskTransitions(tasks: TaskModel, listener: TaskTransitionListener) {
  const latest = useRef(listener);
  useLayoutEffect(() => { latest.current = listener; });
  const { subscribeTransitions } = tasks;
  useLayoutEffect(() => subscribeTransitions((previous, next) => latest.current(previous, next)), [subscribeTransitions]);
}

/** Read-only task state for views; views change tasks through feature actions. */
export const [TaskStateProvider, useTaskState] = createFeatureContext<TaskState>('TaskState');
