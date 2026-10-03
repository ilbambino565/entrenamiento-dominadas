import type { MatchEvent } from './events';
import type { MatchState } from './state';
import { matchClockMs, playedShare, playerPlayedMs } from './time';

/**
 * Resumen del partido. Es una proyección de usar y tirar sobre el estado: no
 * guarda nada y se recalcula con cada `now` (barato: 14 jugadores × 6 × 6).
 */

export interface PlayerSummary {
  playerId: string;
  playedMs: number;
  /** 0..1 respecto al reloj acumulado del partido. */
  share: number;
  entries: number;
  wasStarter: boolean;
  addedLate: boolean;
  onFieldNow: boolean;
}

export interface MatchSummary {
  clockMs: number;
  /** Orden: el de `config.squad` y luego los añadidos. NUNCA por minutos. */
  players: PlayerSummary[];
  maxMs: number;
  minMs: number;
  avgMs: number;
}

export function summarizeMatch(state: MatchState, now: number): MatchSummary {
  const clockMs = matchClockMs(state.clockSegments, now);
  // El orden es el de la convocatoria para que la pantalla no "baile" cuando
  // un jugador adelanta a otro en minutos: el delegado busca por nombre.
  const squad = state.config.squad.filter((id) => state.players[id]);
  const added = Object.keys(state.players).filter((id) => !squad.includes(id));
  const players: PlayerSummary[] = [...squad, ...added].map((playerId) => {
    const p = state.players[playerId];
    const played = playerPlayedMs(state, playerId, now);
    return {
      playerId,
      playedMs: played,
      share: playedShare(played, clockMs),
      entries: p?.entries ?? 0,
      wasStarter: p?.wasStarter ?? false,
      addedLate: p?.addedLate ?? false,
      onFieldNow: p?.location === 'FIELD',
    };
  });
  const minutes = players.map((p) => p.playedMs);
  const total = minutes.reduce((acc, ms) => acc + ms, 0);
  return {
    clockMs,
    players,
    maxMs: minutes.length ? Math.max(...minutes) : 0,
    minMs: minutes.length ? Math.min(...minutes) : 0,
    avgMs: minutes.length ? total / minutes.length : 0,
  };
}

export type SubstitutionLogType = 'PLAYER_ENTERED' | 'PLAYER_LEFT' | 'SUBSTITUTION';

export interface SubstitutionLogEntry {
  matchTimeMs: number;
  period: number;
  inPlayerId: string | null;
  outPlayerId: string | null;
  eventId: string;
  type: SubstitutionLogType;
}

const LOGGED_TYPES: readonly string[] = ['PLAYER_ENTERED', 'PLAYER_LEFT', 'SUBSTITUTION'];

/** Entradas, salidas y cambios no anulados, en orden de `seq`. */
export function substitutionLog(events: readonly MatchEvent[]): SubstitutionLogEntry[] {
  return [...events]
    .filter((e) => e.voidedAt == null && LOGGED_TYPES.includes(e.type))
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({
      matchTimeMs: e.matchTimeMs,
      period: e.period,
      inPlayerId: e.type === 'PLAYER_LEFT' ? null : e.playerId,
      outPlayerId: e.type === 'PLAYER_LEFT' ? e.playerId : e.type === 'SUBSTITUTION' ? e.secondaryPlayerId : null,
      eventId: e.id,
      type: e.type as SubstitutionLogType,
    }));
}
