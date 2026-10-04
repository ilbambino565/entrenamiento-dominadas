import type { Match, MatchPlayer, MatchProgress } from '../core/match';

/**
 * Puerto de persistencia de partidos. Almacén de filas sin lógica: decidir
 * estados y minutos es cosa del motor del partido y de la timeline.
 *
 * Implementaciones: SQLite (nativo) y en memoria. Las dos pasan el mismo contrato.
 */
export interface MatchRepository {
  /** Inserta el partido y su convocatoria en una sola transacción. Rechaza si el id ya existe. */
  createMatch(match: Match, players: readonly MatchPlayer[]): Promise<void>;
  /** Un partido por id. `null` si no existe. */
  getMatch(id: string): Promise<Match | null>;
  /** Partidos NO eliminados, de la fecha más reciente a la más antigua (después `createdAt` desc e id). */
  listRecentMatches(limit?: number): Promise<Match[]>;
  /** Convocados del partido en el orden en que se guardaron. */
  listMatchPlayers(matchId: string): Promise<MatchPlayer[]>;
  /** Actualiza estado, parte y marcas de inicio/fin. Rechaza con NOT_FOUND si el partido no existe. */
  saveProgress(matchId: string, progress: MatchProgress): Promise<void>;
}

export const DEFAULT_RECENT_MATCHES_LIMIT = 50;

export type MatchRepositoryErrorCode = 'STORAGE' | 'CORRUPT' | 'NOT_FOUND';

export class MatchRepositoryError extends Error {
  readonly code: MatchRepositoryErrorCode;
  override readonly cause?: unknown;

  constructor(code: MatchRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MatchRepositoryError';
    this.code = code;
    this.cause = cause;
  }
}
