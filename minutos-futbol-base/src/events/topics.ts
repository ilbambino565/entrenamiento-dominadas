import type { MatchEndReason, MatchEvent } from '../core/events';
import type { CameraEventMap } from '../camera/types';

/**
 * Catálogo de temas del EventBus interno.
 *
 * El MatchEngine publica; quien quiera reaccionar (cámara, avisos, estadísticas)
 * se suscribe. Ningún módulo importa a otro para enterarse de lo que pasa.
 */
export interface MatchBusEventMap {
  'match.started': { matchId: string; timestamp: number; period: number };
  'match.paused': { matchId: string; timestamp: number; period: number };
  'match.resumed': { matchId: string; timestamp: number; period: number };
  'match.halftime': { matchId: string; timestamp: number; period: number };
  'match.period.started': { matchId: string; timestamp: number; period: number };
  'match.finished': { matchId: string; timestamp: number; reason: MatchEndReason };

  'player.entered': { matchId: string; playerId: string; timestamp: number; matchTimeMs: number };
  'player.left': { matchId: string; playerId: string; timestamp: number; matchTimeMs: number };
  'player.substituted': {
    matchId: string;
    inPlayerId: string;
    outPlayerId: string;
    timestamp: number;
    matchTimeMs: number;
  };

  /** Cualquier evento añadido a la timeline (incluidos los de cámara). */
  'match.event.recorded': { event: MatchEvent };
  'match.event.undone': { event: MatchEvent };
}

export type AppEventMap = MatchBusEventMap & CameraEventMap;

export type AppTopic = keyof AppEventMap;
