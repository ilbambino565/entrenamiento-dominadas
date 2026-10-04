import type { GameFormatId } from './formats';
import type { MatchStatus } from './state';

/**
 * Partido guardado (hito M4, docs/02 tablas `match` y `match_player`). Tipos
 * puros, sin React ni SQLite. La timeline sigue siendo la fuente de verdad: los
 * campos de progreso (`status`, `currentPeriod`, `startedAt`, `finishedAt`) son
 * una proyección que se guarda para listar partidos sin regenerarlos.
 */
export type HomeAway = 'HOME' | 'AWAY';

export interface Match {
  id: string;
  teamId: string;
  opponent: string;
  /** Fecha del partido (epoch ms). */
  scheduledAt: number;
  /** Formato, jugadores en campo, partes y duración: copiados del equipo al crear; inmutables. */
  format: GameFormatId;
  playersOnField: number;
  periodsCount: number;
  periodDurationMs: number;
  homeAway: HomeAway | null;
  competition: string | null;
  matchday: string | null;
  status: MatchStatus;
  currentPeriod: number;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** La parte de `Match` que cambia mientras se juega. */
export type MatchProgress = Pick<Match, 'status' | 'currentPeriod' | 'startedAt' | 'finishedAt' | 'updatedAt'>;

/** Convocado en un partido: foto del dorsal y alineación planificada. */
export interface MatchPlayer {
  id: string;
  matchId: string;
  playerId: string;
  /** Foto del dorsal en ese partido (puede cambiar luego en la plantilla). */
  shirtNumber: number | null;
  isGoalkeeper: boolean;
  inInitialLineup: boolean;
  /** Orden en el banquillo; null si es titular. */
  benchOrder: number | null;
}
