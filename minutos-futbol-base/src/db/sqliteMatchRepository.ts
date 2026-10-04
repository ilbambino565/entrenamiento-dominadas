import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import { matchPlayerToRow, matchToRow, rowToMatch, rowToMatchPlayer, type MatchPlayerRow, type MatchRow } from './matchMappers';
import { DEFAULT_RECENT_MATCHES_LIMIT, MatchRepositoryError, type MatchRepository } from './matchRepository';

/**
 * MatchRepository sobre expo-sqlite (tablas `match` y `match_player`, migración 3).
 *
 * - `createMatch` es un INSERT del partido y de cada convocado en UNA
 *   transacción por la conexión principal (`withTransactionAsync`): es la que
 *   tiene `foreign_keys=ON` (ver `client.ts`). Si falla una fila, no se guarda ninguna.
 * - `saveProgress` solo toca las columnas de progreso y `updated_at`.
 * - Errores del driver → `MatchRepositoryError` 'STORAGE' con la causa; una
 *   fila ilegible sale como 'CORRUPT' desde los mappers.
 */

const MATCH_COLUMNS = [
  'id',
  'team_id',
  'opponent',
  'scheduled_at',
  'format',
  'players_on_field',
  'periods_count',
  'period_duration_ms',
  'home_away',
  'competition',
  'matchday',
  'status',
  'current_period',
  'started_at',
  'finished_at',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

const MATCH_PLAYER_COLUMNS = [
  'id',
  'match_id',
  'player_id',
  'shirt_number',
  'is_goalkeeper',
  'in_initial_lineup',
  'bench_order',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

const insertSql = (table: string, columns: readonly string[]): string =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;

const INSERT_MATCH_SQL = insertSql('match', MATCH_COLUMNS);
const INSERT_MATCH_PLAYER_SQL = insertSql('match_player', MATCH_PLAYER_COLUMNS);
const SELECT_MATCH_SQL = `SELECT ${MATCH_COLUMNS.join(', ')} FROM match WHERE id = ?`;
const SELECT_RECENT_SQL = `SELECT ${MATCH_COLUMNS.join(', ')} FROM match WHERE deleted_at IS NULL ORDER BY scheduled_at DESC, created_at DESC, id LIMIT ?`;
const SELECT_IN_PROGRESS_SQL = `SELECT ${MATCH_COLUMNS.join(', ')} FROM match WHERE deleted_at IS NULL AND status IN ('RUNNING', 'PAUSED', 'HALFTIME') ORDER BY updated_at DESC, created_at DESC, id LIMIT 1`;
// rowid = orden de inserción = orden de la convocatoria.
const SELECT_PLAYERS_SQL = `SELECT ${MATCH_PLAYER_COLUMNS.join(', ')} FROM match_player WHERE match_id = ? AND deleted_at IS NULL ORDER BY rowid`;
const UPDATE_PROGRESS_SQL =
  'UPDATE match SET status = ?, current_period = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?';

const matchParams = (row: MatchRow): SQLiteBindValue[] => MATCH_COLUMNS.map((column) => row[column]);
const playerParams = (row: MatchPlayerRow): SQLiteBindValue[] => MATCH_PLAYER_COLUMNS.map((column) => row[column]);

async function guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MatchRepositoryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new MatchRepositoryError('STORAGE', `${operation}: ${message}`, error);
  }
}

export function createSqliteMatchRepository(db: SQLiteDatabase): MatchRepository {
  return {
    createMatch: (match, players) =>
      guarded('createMatch', () =>
        db.withTransactionAsync(async () => {
          await db.runAsync(INSERT_MATCH_SQL, matchParams(matchToRow(match)));
          for (const player of players) {
            await db.runAsync(INSERT_MATCH_PLAYER_SQL, playerParams(matchPlayerToRow(player, match.createdAt)));
          }
        }),
      ),

    getMatch: (id) =>
      guarded('getMatch', async () => {
        const row = await db.getFirstAsync<MatchRow>(SELECT_MATCH_SQL, [id]);
        return row ? rowToMatch(row) : null;
      }),

    listRecentMatches: (limit = DEFAULT_RECENT_MATCHES_LIMIT) =>
      guarded('listRecentMatches', async () => {
        const rows = await db.getAllAsync<MatchRow>(SELECT_RECENT_SQL, [limit]);
        return rows.map(rowToMatch);
      }),

    findInProgressMatch: () =>
      guarded('findInProgressMatch', async () => {
        const row = await db.getFirstAsync<MatchRow>(SELECT_IN_PROGRESS_SQL);
        return row ? rowToMatch(row) : null;
      }),

    listMatchPlayers: (matchId) =>
      guarded('listMatchPlayers', async () => {
        const rows = await db.getAllAsync<MatchPlayerRow>(SELECT_PLAYERS_SQL, [matchId]);
        return rows.map(rowToMatchPlayer);
      }),

    saveProgress: (matchId, progress) =>
      guarded('saveProgress', async () => {
        const result = await db.runAsync(UPDATE_PROGRESS_SQL, [
          progress.status,
          progress.currentPeriod,
          progress.startedAt,
          progress.finishedAt,
          progress.updatedAt,
          matchId,
        ]);
        if (result.changes === 0) throw new MatchRepositoryError('NOT_FOUND', `saveProgress: no existe el partido ${matchId}`);
      }),
  };
}
