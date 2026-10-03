import type { FieldPosition, MatchEndReason, UnavailableReason } from './events';

/**
 * Estado del partido DERIVADO de la timeline de eventos. Nunca se persiste como
 * verdad: se reconstruye con `reduceMatch(config, events)`.
 */

export type MatchStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'HALFTIME' | 'FINISHED';

export type PlayerLocation = 'FIELD' | 'BENCH';

/** Tramo con el reloj del partido en marcha. `endedAt` null = en marcha ahora. */
export interface ClockSegment {
  period: number;
  startedAt: number;
  endedAt: number | null;
}

/** Tramo de un jugador en el campo. `endedAt` null = en el campo ahora. */
export interface PlayerInterval {
  playerId: string;
  startedAt: number;
  endedAt: number | null;
  startEventId: string;
  endEventId: string | null;
}

export interface MatchPlayerState {
  playerId: string;
  location: PlayerLocation;
  position: FieldPosition | null;
  isGoalkeeper: boolean;
  unavailable: UnavailableReason | null;
  /** En el campo en el pitido inicial (MATCH_STARTED), no en la planificación. */
  wasStarter: boolean;
  /** Entradas desde el banquillo con el partido ya empezado. */
  entries: number;
  addedLate: boolean;
}

export interface MatchConfig {
  matchId: string;
  playersOnField: number;
  periodsCount: number;
  periodDurationMs: number;
  /** Convocados al crear el partido. Pueden añadirse más con PLAYER_ADDED. */
  squad: readonly string[];
}

export interface MatchState {
  config: MatchConfig;
  status: MatchStatus;
  /** 0 antes de empezar; 1..periodsCount después. */
  currentPeriod: number;
  endReason: MatchEndReason | null;
  players: Record<string, MatchPlayerState>;
  clockSegments: ClockSegment[];
  intervals: PlayerInterval[];
  /** seq del último evento aplicado (0 si ninguno). */
  lastSeq: number;
}

/** Error de reglas del partido: la acción es imposible en el estado actual. */
export class MatchRuleError extends Error {
  constructor(
    public readonly code: MatchRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatchRuleError';
  }
}

export type MatchRuleErrorCode =
  | 'INVALID_STATUS'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_ALREADY_ON_FIELD'
  | 'PLAYER_NOT_ON_FIELD'
  | 'FIELD_FULL'
  | 'INVALID_POSITION'
  | 'INVALID_EVENT'
  | 'TIMESTAMP_BEFORE_PREVIOUS'
  | 'NO_MORE_PERIODS';
