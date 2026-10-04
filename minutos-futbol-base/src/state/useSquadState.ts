import { useCallback, useSyncExternalStore } from 'react';
import type { SquadService, SquadState } from '../app-services/squadService';

/**
 * Equipo y plantilla como almacén externo (mismo patrón que `useMatchState`).
 * El servicio sustituye el estado por un objeto nuevo solo después de
 * persistir y notifica entonces, así `getState` es estable entre
 * notificaciones (React no entra en bucle) y la pantalla nunca muestra algo
 * que no esté guardado.
 */
export function useSquadState(service: SquadService): SquadState {
  const subscribe = useCallback((onChange: () => void) => service.subscribe(onChange), [service]);
  const getState = useCallback(() => service.getState(), [service]);
  return useSyncExternalStore(subscribe, getState, getState);
}
