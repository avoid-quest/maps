import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createFeatureContext } from './feature-context';
import { initialTaskState, taskReducer, type TaskAction, type TaskState } from './task-model';
import { createTaskStore, type TaskTransitionListener } from './task-store';

export type { TaskTransitionListener } from './task-store';
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
  const [store] = useState(() => createTaskStore(apply));
  return { state, getState: store.getState, dispatch: store.dispatch, subscribeTransitions: store.subscribe };
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
