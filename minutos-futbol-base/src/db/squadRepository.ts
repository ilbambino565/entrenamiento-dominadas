import type { Player, Team } from '../core/team';

/**
 * Puerto de persistencia de equipo y plantilla. Es un almacén de filas sin
 * lógica: validar, ordenar, anonimizar y construir alineaciones es cosa de
 * `core/squad.ts` y del servicio (`app-services/squadService.ts`).
 *
 * Implementaciones: SQLite (nativo), en memoria con almacenamiento clave-valor
 * opcional (web: localStorage; tests: nada). Las tres pasan el mismo contrato.
 */
export interface SquadRepository {
  /** Equipo único de la app (MVP: un entrenador, un equipo). `null` si aún no existe. */
  getTeam(): Promise<Team | null>;
  /** Inserta o sustituye el equipo por id. */
  saveTeam(team: Team): Promise<void>;
  /** Jugadores NO eliminados del equipo, ordenados por `sortOrder` y después `createdAt`. Incluye inactivos. */
  listPlayers(teamId: string): Promise<Player[]>;
  /** Un jugador por id, también si está eliminado. `null` si no existe. */
  getPlayer(id: string): Promise<Player | null>;
  /** Inserta o sustituye (todas las columnas) por id. */
  savePlayer(player: Player): Promise<void>;
  /** Varias filas de una vez, en una sola transacción (importar, reordenar). */
  savePlayers(players: readonly Player[]): Promise<void>;
}

export type SquadRepositoryErrorCode = 'STORAGE' | 'CORRUPT';

export class SquadRepositoryError extends Error {
  readonly code: SquadRepositoryErrorCode;
  override readonly cause?: unknown;

  constructor(code: SquadRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'SquadRepositoryError';
    this.code = code;
    this.cause = cause;
  }
}

/** Almacén clave-valor síncrono (localStorage en web) para la implementación en memoria. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
