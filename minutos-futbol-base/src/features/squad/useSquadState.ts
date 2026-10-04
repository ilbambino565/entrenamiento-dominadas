import { useEffect } from 'react';
import type { SquadService, SquadState } from '../../app-services/squadService';
import { useSquadState } from '../../state';

/**
 * Estado del servicio de plantilla para las pantallas P2-P4: el almacén
 * externo de `state/useSquadState` más la carga inicial.
 *
 * Dispara `service.load()` al montar: por contrato es idempotente y comparte
 * la lectura en vuelo, de modo que cualquiera de las pantallas (pestaña
 * Plantilla, pestaña Equipo) puede ser la primera en abrirse sin depender de
 * que el shell haya cargado antes. Un fallo de carga no se trata aquí: el
 * servicio lo deja en `state.status = 'error'` y las pantallas lo muestran.
 */
export function useSquadScreenState(service: SquadService): SquadState {
  useEffect(() => {
    service.load().catch(() => undefined);
  }, [service]);
  return useSquadState(service);
}

/** Texto para la pantalla de un error cualquiera (SquadError, Error o lo que sea). */
export function errorMessage(error: unknown, fallback = 'Algo ha fallado'): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
