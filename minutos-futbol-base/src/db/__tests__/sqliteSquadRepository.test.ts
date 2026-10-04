import type { SQLiteBindParams, SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { migrate } from '../migrate';
import { DB_PRAGMAS, MIGRATIONS, SCHEMA_VERSION } from '../schema';
import { teamToRow } from '../squadMappers';
import { SquadRepositoryError } from '../squadRepository';
import { createSqliteSquadRepository } from '../sqliteSquadRepository';
import { T0 } from './fixtures';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';
import { TEAM_ID, describeSquadRepositoryContract, makePlayer, makeTeam, repositoryError } from './squadRepositoryContract';

/**
 * Doble que solo registra: comprueba la forma de las sentencias (UPSERT,
 * transacción por la conexión principal, orden de parámetros) y provoca
 * errores del driver. La exclusiva lanza a propósito: abre otra conexión sin
 * `foreign_keys` y el repositorio no debe usarla nunca.
 */
interface RecordedCall {
  sql: string;
  params: unknown[];
}

function createRecordingDb() {
  const state = {
    log: [] as string[],
    calls: [] as RecordedCall[],
    failWhen: null as { pattern: RegExp; error: Error } | null,
    firstRow: null as unknown,
    rows: [] as unknown[],
  };
  const record = (sql: string, params?: SQLiteBindParams) => {
    state.calls.push({ sql, params: Array.isArray(params) ? params : [] });
    state.log.push(sql.split(' ').slice(0, 3).join(' '));
    if (state.failWhen?.pattern.test(sql)) throw state.failWhen.error;
  };
  const db = {
    async execAsync(sql: string) {
      record(sql);
    },
    async runAsync(sql: string, params?: SQLiteBindParams): Promise<SQLiteRunResult> {
      record(sql, params);
      return { changes: 1, lastInsertRowId: 0 };
    },
    async getAllAsync(sql: string, params?: SQLiteBindParams) {
      record(sql, params);
      return state.rows;
    },
    async getFirstAsync(sql: string, params?: SQLiteBindParams) {
      record(sql, params);
      return state.firstRow;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      state.log.push('BEGIN');
      try {
        await task();
        state.log.push('COMMIT');
      } catch (error) {
        state.log.push('ROLLBACK');
        throw error;
      }
    },
    async withExclusiveTransactionAsync() {
      throw new Error('withExclusiveTransactionAsync no debe usarse: su conexión no tiene foreign_keys');
    },
  } as unknown as SQLiteDatabase;
  return { db, state };
}

const TEAM_COLUMNS =
  'id, name, category, federation_name, default_format, default_formation, periods_count, period_duration_ms, display_name_mode, created_at, updated_at, deleted_at';
const PLAYER_COLUMNS =
  'id, team_id, first_name, last_name, shirt_number, is_goalkeeper, is_active, photo_uri, photo_consent, sort_order, created_at, updated_at, deleted_at';

describe('SqliteSquadRepository: forma de las sentencias (doble que registra)', () => {
  let fake: ReturnType<typeof createRecordingDb>;
  let repo: ReturnType<typeof createSqliteSquadRepository>;

  beforeEach(() => {
    fake = createRecordingDb();
    repo = createSqliteSquadRepository(fake.db);
  });

  it('saveTeam: UPSERT por id de todas las columnas, en una transacción de la conexión principal', async () => {
    const team = makeTeam({ category: null, defaultFormation: '3-1-2' });
    await repo.saveTeam(team);
    expect(fake.state.log).toEqual(['BEGIN', 'INSERT INTO team', 'COMMIT']);
    expect(fake.state.calls[0]?.sql).toBe(
      `INSERT INTO team (${TEAM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, federation_name = excluded.federation_name, default_format = excluded.default_format, default_formation = excluded.default_formation, periods_count = excluded.periods_count, period_duration_ms = excluded.period_duration_ms, display_name_mode = excluded.display_name_mode, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
    );
    expect(fake.state.calls[0]?.params).toEqual([
      TEAM_ID,
      'CD Prueba',
      null,
      null,
      'F7',
      '3-1-2',
      2,
      25 * 60_000,
      'full',
      T0,
      T0,
      null,
    ]);
  });

  it('savePlayers: UNA transacción con un UPSERT por fila, parámetros en el orden de las columnas y booleanos como 0/1', async () => {
    const p1 = makePlayer(1, { lastName: 'Gómez', photoUri: 'data:image/jpeg;base64,AAAA', photoConsent: true });
    const p2 = makePlayer(2, { isActive: false, deletedAt: T0 + 5 });
    await repo.savePlayers([p1, p2]);
    expect(fake.state.log).toEqual(['BEGIN', 'INSERT INTO player', 'INSERT INTO player', 'COMMIT']);
    expect(fake.state.calls[0]?.sql).toMatch(
      new RegExp(`^INSERT INTO player \\(${PLAYER_COLUMNS}\\) VALUES \\((\\?, ){12}\\?\\) ON CONFLICT\\(id\\) DO UPDATE SET team_id = excluded\\.team_id, .*deleted_at = excluded\\.deleted_at$`),
    );
    expect(fake.state.calls[0]?.sql).not.toMatch(/SET id =/);
    expect(fake.state.calls[0]?.params).toEqual([
      'player-1',
      TEAM_ID,
      'Ana',
      'Gómez',
      1,
      1,
      1,
      'data:image/jpeg;base64,AAAA',
      1,
      0,
      T0 + 1,
      T0 + 1,
      null,
    ]);
    expect(fake.state.calls[1]?.params).toEqual(['player-2', TEAM_ID, 'Bea', null, 2, 0, 0, null, 0, 1, T0 + 2, T0 + 2, T0 + 5]);
  });

  it('savePlayers: el lote vacío no toca la base; savePlayer es un lote de uno', async () => {
    await repo.savePlayers([]);
    expect(fake.state.log).toEqual([]);
    await repo.savePlayer(makePlayer(1));
    expect(fake.state.log).toEqual(['BEGIN', 'INSERT INTO player', 'COMMIT']);
  });

  it('lecturas: getTeam (primer equipo vivo por created_at), listPlayers (orden manual) y getPlayer (también eliminados)', async () => {
    await repo.getTeam();
    await repo.listPlayers('t-9');
    await repo.getPlayer('p-9');
    expect(fake.state.calls).toEqual([
      { sql: `SELECT ${TEAM_COLUMNS} FROM team WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`, params: [] },
      {
        sql: `SELECT ${PLAYER_COLUMNS} FROM player WHERE team_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at, id`,
        params: ['t-9'],
      },
      { sql: `SELECT ${PLAYER_COLUMNS} FROM player WHERE id = ?`, params: ['p-9'] },
    ]);
    expect(fake.state.log).not.toContain('BEGIN');
  });

  it('un error del driver se envuelve en STORAGE con su causa, tras ROLLBACK', async () => {
    const cause = new Error('database is locked');
    fake.state.failWhen = { pattern: /^INSERT INTO player/, error: cause };
    const error = await repositoryError(repo.savePlayers([makePlayer(1), makePlayer(2)]));
    expect(error.code).toBe('STORAGE');
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('database is locked');
    expect(fake.state.log).toEqual(['BEGIN', 'INSERT INTO player', 'ROLLBACK']);
  });

  it('una fila corrupta sale como CORRUPT (del mapper) sin reenvolverse', async () => {
    fake.state.firstRow = { ...teamToRow(makeTeam()), display_name_mode: 'alien' };
    const error = await repositoryError(repo.getTeam());
    expect(error.code).toBe('CORRUPT');
    expect(error.message).toContain(TEAM_ID);
    expect(error.message).toContain('display_name_mode');
  });
});

/**
 * La prueba que importa: el mismo contrato que la implementación en memoria,
 * con el SQL ejecutándose en un SQLite real migrado y con foreign_keys=ON.
 */
describeWithSqlite('SqliteSquadRepository contra SQLite real', () => {
  const opened: NodeSqliteDatabase[] = [];

  afterAll(() => {
    for (const db of opened) db.close();
  });

  const open = async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    for (const pragma of DB_PRAGMAS) native.exec(pragma);
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    return { native, db, repo: createSqliteSquadRepository(db) };
  };

  describeSquadRepositoryContract('SqliteSquadRepository', async () => (await open()).repo);

  it('migrar una base en versión 1 con eventos a la 2 conserva match_event y deja user_version = 2', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    for (const pragma of DB_PRAGMAS) native.exec(pragma);
    const db = createNodeSqliteDouble(native);
    const userVersion = () => (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

    await migrate(db, [MIGRATIONS[0]!]);
    expect(userVersion()).toBe(1);
    const insert = native.prepare(
      'INSERT INTO match_event (id, match_id, seq, type, timestamp, match_time_ms, period, player_id, secondary_player_id, metadata, source, voided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('e1', 'm1', 1, 'MATCH_STARTED', T0, 0, 1, null, null, '{}', 'user', null, T0);
    insert.run('e2', 'm1', 2, 'PLAYER_ENTERED', T0 + 1000, 1000, 1, 'player-1', null, '{"position":{"x":0.5,"y":0.5}}', 'user', null, T0 + 1000);
    insert.run('e3', 'm1', 3, 'MATCH_PAUSED', T0 + 2000, 2000, 1, null, null, '{}', 'user', T0 + 2500, T0 + 2000);
    const before = native.prepare('SELECT * FROM match_event ORDER BY seq').all();

    await migrate(db, MIGRATIONS.slice(0, 2));
    expect(userVersion()).toBe(2);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(native.prepare('SELECT * FROM match_event ORDER BY seq').all()).toEqual(before);
    const tables = (native.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['app_meta', 'match_event', 'player', 'team']);
    await migrate(db);
    expect((native.prepare('PRAGMA index_info(idx_player_team_order)').all() as { name: string }[]).map((i) => i.name)).toEqual([
      'team_id',
      'sort_order',
    ]);

    // La base migrada sirve tal cual al repositorio.
    const repo = createSqliteSquadRepository(db);
    await repo.saveTeam(makeTeam());
    await repo.savePlayer(makePlayer(1));
    expect(await repo.listPlayers(TEAM_ID)).toEqual([makePlayer(1)]);
  });

  it('foreign_keys: un jugador con team_id inexistente falla con STORAGE (FOREIGN KEY) y no se guarda', async () => {
    const { repo, native } = await open();
    const orphan = makePlayer(1, { teamId: 'nadie' });
    const error = await repositoryError(repo.savePlayer(orphan));
    expect(error.code).toBe('STORAGE');
    expect(error).toBeInstanceOf(SquadRepositoryError);
    expect(String((error.cause as Error).message)).toMatch(/FOREIGN KEY/);
    expect(await repo.getPlayer(orphan.id)).toBeNull();
    expect(native.prepare('SELECT COUNT(*) AS n FROM player').get()).toEqual({ n: 0 });
  });

  it('el UPSERT conserva una sola fila por id en la tabla (COUNT) y reescribe todas las columnas', async () => {
    const { repo, native } = await open();
    await repo.saveTeam(makeTeam());
    await repo.saveTeam(makeTeam({ name: 'Renombrado', category: null, updatedAt: T0 + 1 }));
    await repo.savePlayer(makePlayer(1));
    await repo.savePlayer(makePlayer(1, { firstName: 'Ana María', shirtNumber: null, deletedAt: T0 + 2 }));
    expect(native.prepare('SELECT COUNT(*) AS n FROM team').get()).toEqual({ n: 1 });
    expect(native.prepare('SELECT COUNT(*) AS n FROM player').get()).toEqual({ n: 1 });
    expect(native.prepare('SELECT name, category FROM team').get()).toEqual({ name: 'Renombrado', category: null });
    expect(native.prepare('SELECT first_name, shirt_number, deleted_at FROM player').get()).toEqual({
      first_name: 'Ana María',
      shirt_number: null,
      deleted_at: T0 + 2,
    });
  });

  it('getTeam ignora un equipo con deleted_at y una fila ilegible sale como CORRUPT con su id', async () => {
    const { repo, native } = await open();
    await repo.saveTeam(makeTeam());
    await repo.savePlayer(makePlayer(1));

    native.prepare('UPDATE player SET is_goalkeeper = 2 WHERE id = ?').run('player-1');
    const corruptPlayer = await repositoryError(repo.listPlayers(TEAM_ID));
    expect(corruptPlayer.code).toBe('CORRUPT');
    expect(corruptPlayer.message).toContain('player-1');
    expect(corruptPlayer.message).toContain('is_goalkeeper');

    native.prepare('UPDATE team SET default_format = ? WHERE id = ?').run('F5', TEAM_ID);
    const corruptTeam = await repositoryError(repo.getTeam());
    expect(corruptTeam.code).toBe('CORRUPT');
    expect(corruptTeam.message).toContain(TEAM_ID);

    native.prepare('UPDATE team SET default_format = ?, deleted_at = ? WHERE id = ?').run('F7', T0 + 10, TEAM_ID);
    expect(await repo.getTeam()).toBeNull();
  });
});
