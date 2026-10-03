import { useCallback, useSyncExternalStore } from 'react';
import type { MatchEngine } from '../app-services/matchEngine';
import type { MatchState } from '../core';

/**
 * Estado del partido como almacén externo. El motor ya notifica tras cada
 * commit con un objeto nuevo, así que `getState` es estable entre
 * notificaciones y React no entra en bucle.
 */
export function useMatchState(engine: MatchEngine): MatchState {
  const subscribe = useCallback((onChange: () => void) => engine.subscribe(onChange), [engine]);
  const getState = useCallback(() => engine.getState(), [engine]);
  return useSyncExternalStore(subscribe, getState, getState);
}
