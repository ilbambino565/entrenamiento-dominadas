import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import { fixtureToRow, rowToFixture, type FixtureRow } from './fixtureMappers';
import { FixtureRepositoryError, type FixtureRepository } from './fixtureRepository';

/**
 * FixtureRepository sobre expo-sqlite (tabla `fixture`, migración 5).
 *
 * - `replaceFixtures` borra los partidos del equipo y inserta los nuevos en UNA
 *   transacción de la conexión principal (`foreign_keys=ON`, ver `client.ts`): si
 *   una fila falla, el calendario anterior queda intacto.
 * - Los errores del driver se envuelven en 'STORAGE'; una fila ilegible sale como
 *   'CORRUPT' desde el mapper.
 */
const COLUMNS = [
  'id',
  'team_id',
  'matchday',
  'matchday_date',
  'opponent',
  'home_away',
  'venue',
  'scheduled_at',
  'has_time',
  'competition',
  'season',
  'match_id',
  'created_at',
  'updated_at',
] as const;

const INSERT_SQL = `INSERT INTO fixture (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`;
const SELECT_SQL = `SELECT ${COLUMNS.join(', ')} FROM fixture WHERE team_id = ? ORDER BY scheduled_at, matchday, id`;
const DELETE_SQL = 'DELETE FROM fixture WHERE team_id = ?';
const LINK_SQL = 'UPDATE fixture SET match_id = ?, updated_at = ? WHERE id = ?';

const params = (row: FixtureRow): SQLiteBindValue[] => COLUMNS.map((column) => row[column]);

async function guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FixtureRepositoryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new FixtureRepositoryError('STORAGE', `${operation}: ${message}`, error);
  }
}

export function createSqliteFixtureRepository(db: SQLiteDatabase): FixtureRepository {
  return {
    listFixtures: (teamId) =>
      guarded('listFixtures', async () => {
        const rows = await db.getAllAsync<FixtureRow>(SELECT_SQL, [teamId]);
        return rows.map(rowToFixture);
      }),

    replaceFixtures: (teamId, fixtures) =>
      guarded('replaceFixtures', () =>
        db.withTransactionAsync(async () => {
          await db.runAsync(DELETE_SQL, [teamId]);
          for (const fixture of fixtures) {
            if (fixture.teamId !== teamId) throw new FixtureRepositoryError('STORAGE', `replaceFixtures: el partido ${fixture.id} es de otro equipo`);
            await db.runAsync(INSERT_SQL, params(fixtureToRow(fixture)));
          }
        }),
      ),

    linkMatch: (fixtureId, matchId, updatedAt) =>
      guarded('linkMatch', async () => {
        const result = await db.runAsync(LINK_SQL, [matchId, updatedAt, fixtureId]);
        if (result.changes === 0) throw new FixtureRepositoryError('NOT_FOUND', `linkMatch: no existe el partido del calendario ${fixtureId}`);
      }),
  };
}
