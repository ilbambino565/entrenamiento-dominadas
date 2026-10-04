import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type { Player } from '../core/team';
import { playerToRow, rowToPlayer, rowToTeam, teamToRow, type PlayerRow, type TeamRow } from './squadMappers';
import { SquadRepositoryError, type SquadRepository } from './squadRepository';

/**
 * SquadRepository sobre expo-sqlite (tablas `team` y `player`, migración 2).
 *
 * - Guardar es un UPSERT por id (`INSERT … ON CONFLICT(id) DO UPDATE SET` de
 *   todas las columnas): la fila queda exactamente como el objeto recibido.
 * - Las escrituras van en `withTransactionAsync`, que usa ESTA conexión: la
 *   que tiene `foreign_keys=ON` (ver `client.ts`; la exclusiva abre otra
 *   conexión sin el pragma y no comprobaría `player.team_id`). `savePlayers`
 *   es una sola transacción: si una fila falla, no se guarda ninguna.
 * - Los errores del driver se envuelven en `SquadRepositoryError` 'STORAGE'
 *   con la causa; una fila ilegible sale como 'CORRUPT' desde los mappers.
 */

const TEAM_COLUMNS = [
  'id',
  'name',
  'category',
  'federation_name',
  'default_format',
  'default_formation',
  'periods_count',
  'period_duration_ms',
  'display_name_mode',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

const PLAYER_COLUMNS = [
  'id',
  'team_id',
  'first_name',
  'last_name',
  'shirt_number',
  'is_goalkeeper',
  'is_active',
  'photo_uri',
  'photo_consent',
  'sort_order',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

/** `INSERT … ON CONFLICT(id) DO UPDATE SET col = excluded.col, …` para todas las columnas menos `id`. */
function upsertSql(table: string, columns: readonly string[]): string {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`;
}

const UPSERT_TEAM_SQL = upsertSql('team', TEAM_COLUMNS);
const UPSERT_PLAYER_SQL = upsertSql('player', PLAYER_COLUMNS);
const SELECT_TEAM_SQL = `SELECT ${TEAM_COLUMNS.join(', ')} FROM team WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`;
const SELECT_PLAYERS_SQL = `SELECT ${PLAYER_COLUMNS.join(', ')} FROM player WHERE team_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id`;
const SELECT_PLAYER_SQL = `SELECT ${PLAYER_COLUMNS.join(', ')} FROM player WHERE id = ?`;

/** Parámetros posicionales en el MISMO orden que las columnas. */
const teamParams = (row: TeamRow): SQLiteBindValue[] => TEAM_COLUMNS.map((column) => row[column]);
const playerParams = (row: PlayerRow): SQLiteBindValue[] => PLAYER_COLUMNS.map((column) => row[column]);

function toRepositoryError(error: unknown, operation: string): SquadRepositoryError {
  if (error instanceof SquadRepositoryError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SquadRepositoryError('STORAGE', `${operation}: ${message}`, error);
}

async function guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toRepositoryError(error, operation);
  }
}

export function createSqliteSquadRepository(db: SQLiteDatabase): SquadRepository {
  const upsertPlayers = async (players: readonly Player[]): Promise<void> => {
    for (const player of players) await db.runAsync(UPSERT_PLAYER_SQL, playerParams(playerToRow(player)));
  };

  return {
    getTeam: () =>
      guarded('getTeam', async () => {
        const row = await db.getFirstAsync<TeamRow>(SELECT_TEAM_SQL);
        return row ? rowToTeam(row) : null;
      }),

    saveTeam: (team) =>
      guarded('saveTeam', () =>
        db.withTransactionAsync(async () => {
          await db.runAsync(UPSERT_TEAM_SQL, teamParams(teamToRow(team)));
        }),
      ),

    listPlayers: (teamId) =>
      guarded('listPlayers', async () => {
        const rows = await db.getAllAsync<PlayerRow>(SELECT_PLAYERS_SQL, [teamId]);
        return rows.map(rowToPlayer);
      }),

    getPlayer: (id) =>
      guarded('getPlayer', async () => {
        const row = await db.getFirstAsync<PlayerRow>(SELECT_PLAYER_SQL, [id]);
        return row ? rowToPlayer(row) : null;
      }),

    savePlayer: (player) => guarded('savePlayer', () => db.withTransactionAsync(() => upsertPlayers([player]))),

    savePlayers: (players) => {
      if (players.length === 0) return Promise.resolve();
      return guarded('savePlayers', () => db.withTransactionAsync(() => upsertPlayers(players)));
    },
  };
}
