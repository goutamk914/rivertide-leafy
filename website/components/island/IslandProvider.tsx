'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IslandScene } from '@rivertide/island';

interface IslandActions {
  /** Show a live activity; with `holdMs` it clears itself unless something replaces it first. */
  readonly show: (scene: IslandScene, holdMs?: number) => void;
  /** Clear the activity, but only if it is still the one with this id (or any, with no id). */
  readonly clear: (id?: string) => void;
}

/** Split in two so the demos, which only call actions, never re-render when the activity changes. */
const ActivityContext = createContext<IslandScene | null>(null);
const ActionsContext = createContext<IslandActions | null>(null);

/** Lets demos on the page drive the navigation island's live activities. */
export function IslandProvider({ children }: { readonly children: ReactNode }) {
  const [activity, setActivity] = useState<IslandScene | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const clear = useCallback((id?: string) => {
    setActivity((current) => (id === undefined || current?.id === id ? null : current));
  }, []);

  const show = useCallback(
    (scene: IslandScene, holdMs?: number) => {
      window.clearTimeout(timer.current);
      setActivity(scene);
      if (holdMs !== undefined) timer.current = window.setTimeout(() => clear(scene.id), holdMs);
    },
    [clear],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const actions = useMemo(() => ({ show, clear }), [show, clear]);
  return (
    <ActionsContext.Provider value={actions}>
      <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The live activity to show on the island, or null. Only the island itself should need this. */
export function useIslandActivity(): IslandScene | null {
  return useContext(ActivityContext);
}

/** Stable `show` / `clear` for components that drive the island. */
export function useIslandActions(): IslandActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useIslandActions must be used inside <IslandProvider>');
  return actions;
}
