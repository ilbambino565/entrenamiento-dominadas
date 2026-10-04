import type { Fixture } from '../core/fixture';

/**
 * Puerto de persistencia del calendario importado de la federación. Almacén de
 * filas sin lógica: cómo se fusiona una reimportación y qué partidos son
 * "próximos" lo decide `core/fixture.ts`. Implementaciones: SQLite y en memoria
 * (con almacenamiento clave-valor opcional en web); las dos pasan el mismo contrato.
 *
 * Los partidos del calendario se borran de verdad al reimportar (no llevan
 * `deleted_at`): son una copia de lo que dice la federación, no datos del entrenador.
 */
export interface FixtureRepository {
  /** Los partidos del equipo por fecha, después jornada e id. */
  listFixtures(teamId: string): Promise<Fixture[]>;
  /** Sustituye TODOS los partidos del equipo por estos, en una transacción: si falla, queda lo que había. */
  replaceFixtures(teamId: string, fixtures: readonly Fixture[]): Promise<void>;
  /** Vincula (o desvincula con `null`) un partido del calendario con el partido jugado. Rechaza con NOT_FOUND si no existe. */
  linkMatch(fixtureId: string, matchId: string | null, updatedAt: number): Promise<void>;
}

export type FixtureRepositoryErrorCode = 'STORAGE' | 'CORRUPT' | 'NOT_FOUND';

export class FixtureRepositoryError extends Error {
  readonly code: FixtureRepositoryErrorCode;
  override readonly cause?: unknown;

  constructor(code: FixtureRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FixtureRepositoryError';
    this.code = code;
    this.cause = cause;
  }
}
