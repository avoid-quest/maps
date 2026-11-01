import { createContext, useContext, type Provider } from 'react';

/** A narrowly scoped context whose hook fails loudly outside AppProviders. */
export function createFeatureContext<T>(name: string): [Provider<T | null>, () => T] {
  const Context = createContext<T | null>(null);
  Context.displayName = name;
  function useFeature(): T {
    const value = useContext(Context);
    if (value === null) throw new Error(`${name} requires AppProviders`);
    return value;
  }
  return [Context.Provider, useFeature];
}
