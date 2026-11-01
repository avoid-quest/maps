import { initialTaskState, taskReducer, type TaskAction, type TaskState } from './task-model';

/** Runs synchronously inside dispatch, before React renders the next task. */
export type TaskTransitionListener = (previous: TaskState, next: TaskState) => void;
export interface TaskStore {
  /** The state including transitions dispatched earlier in the current event. */
  getState(): TaskState;
  dispatch(action: TaskAction): void;
  subscribe(listener: TaskTransitionListener): () => void;
}

/**
 * Keeps a synchronous copy of the task state alongside React's reducer. `apply`
 * enqueues the same action for React, in the same order as this copy changes, so
 * re-entrant dispatches and throwing listeners cannot make the two disagree.
 */
export function createTaskStore(apply: (action: TaskAction) => void, initial: TaskState = initialTaskState): TaskStore {
  let current = initial;
  const listeners = new Set<TaskTransitionListener>();
  return {
    getState: () => current,
    dispatch(action) {
      const previous = current;
      const next = taskReducer(previous, action);
      if (next === previous) return;
      current = next;
      // Enqueue first: React renders only after this event, so listeners still precede it.
      apply(action);
      for (const listener of listeners) listener(previous, next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
