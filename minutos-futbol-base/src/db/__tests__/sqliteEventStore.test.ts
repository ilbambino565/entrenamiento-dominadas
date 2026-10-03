import type { SQLiteBindParams, SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { EventStoreError, type EventStore } from '../eventStore';
import { migrate } from '../migrate';
import { createSqliteEventStore } from '../sqliteEventStore';
import { describeEventStoreContract } from './eventStoreContract';
import { MATCH_ID, T0, makeEvent } from './fixtures';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';

/**
 * Doble que solo registra. Sirve para comprobar la forma de las sentencias
 * (transacciones, orden de parámetros, SQL) con independencia de SQLite, y
 * para provocar errores del driver.
 */
interface RecordedCall {
  sql: string;
  params: unknown[];
  /** Por qué objeto llegó: `db` (conexión principal) o `txn` (exclusiva). */
  via: 'db' | 'txn';
}

interface RecordingDb {
  db: SQLiteDatabase;
  /** Traza lineal: BEGIN / COMMIT / ROLLBACK y cada sentencia con su vía. */
  log: string[];
  calls: RecordedCall[];
  /** Error a lanzar cuando una sentencia case con el patrón. */
  failWhen: { pattern: RegExp; error: Error } | null;
  changes: number;
  firstRow: unknown;
}

function createRecordingDb(): RecordingDb {
  const state: RecordingDb = { db: undefined as unknown as SQLiteDatabase, log: [], calls: [], failWhen: null, changes: 1, firstRow: null };

  const record = (via: 'db' | 'txn', sql: string, params?: SQLiteBindParams) => {
    const list = Array.isArray(params) ? params : [];
    state.calls.push({ sql, params: list, via });
    state.log.push(`${via}:${sql.split(' ').slice(0, 3).join(' ')}`);
    if (state.failWhen && state.failWhen.pattern.test(sql)) throw state.failWhen.error;
  };

  const executor = (via: 'db' | 'txn') => ({
    async execAsync(sql: string) {
      record(via, sql);
    },
    async runAsync(sql: string, params?: SQLiteBindParams): Promise<SQLiteRunResult> {
      record(via, sql, params);
      return { changes: state.changes, lastInsertRowId: 0 };
    },
    async getAllAsync(sql: string, params?: SQLiteBindParams) {
      record(via, sql, params);
      return [];
    },
    async getFirstAsync(sql: string, params?: SQLiteBindParams) {
      record(via, sql, params);
      return state.firstRow;
    },
  });

  const txn = executor('txn') as unknown as SQLiteDatabase;
  const main = {
    ...executor('db'),
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
    async withExclusiveTransactionAsync(task: (t: SQLiteDatabase) => Promise<void>) {
      state.log.push('BEGIN');
      try {
        await task(txn);
        state.log.push('COMMIT');
      } catch (error) {
        state.log.push('ROLLBACK');
        throw error;
      }
    },
  };
  state.db = main as unknown as SQLiteDatabase;
  return state;
}

const uniqueError = () => new Error('Error code 19: UNIQUE constraint failed: match_event.match_id, match_event.seq');

describe('SqliteEventStore: forma de las sentencias (doble que registra)', () => {
  let fake: RecordingDb;
  let store: EventStore;

  beforeEach(() => {
    fake = createRecordingDb();
    store = createSqliteEventStore(fake.db, { now: () => T0 + 999 });
  });

  it('append: un INSERT parametrizado dentro de una transacción, con los parámetros en el orden de las columnas', async () => {
    const event = makeEvent(5, { secondaryPlayerId: 'lucas', voidedAt: T0 + 7 });
    await store.append(event);

    expect(fake.log).toEqual(['BEGIN', 'db:INSERT INTO match_event', 'COMMIT']);
    const [call] = fake.calls;
    expect(call?.sql).toMatch(
      /^INSERT INTO match_event \(id, match_id, seq, type, timestamp, match_time_ms, period, player_id, secondary_player_id, metadata, source, voided_at, created_at\) VALUES \((\?, ){12}\?\)$/,
    );
    expect(call?.params).toEqual([
      event.id,
      MATCH_ID,
      5,
      'PLAYER_ENTERED',
      event.timestamp,
      event.matchTimeMs,
      1,
      'hugo',
      'lucas',
      JSON.stringify(event.metadata),
      'user',
      T0 + 7,
      T0 + 999,
    ]);
  });

  it('append: la violación de UNIQUE se traduce a DUPLICATE_SEQ con la causa, tras ROLLBACK', async () => {
    fake.failWhen = { pattern: /^INSERT/, error: uniqueError() };
    const error: unknown = await store.append(makeEvent(1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('DUPLICATE_SEQ');
    expect((error as EventStoreError).cause).toBeInstanceOf(Error);
    expect(fake.log).toEqual(['BEGIN', 'db:INSERT INTO match_event', 'ROLLBACK']);
  });

  it('cualquier otro error del driver se envuelve en STORAGE con su causa', async () => {
    const cause = new Error('database is locked');
    fake.failWhen = { pattern: /^SELECT/, error: cause };
    const error: unknown = await store.loadEvents(MATCH_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('STORAGE');
    expect((error as EventStoreError).cause).toBe(cause);
    expect((error as EventStoreError).message).toContain('database is locked');
  });

  it('appendMany: una única transacción exclusiva y todos los INSERT por txn', async () => {
    await store.appendMany([makeEvent(1), makeEvent(2), makeEvent(3)]);
    expect(fake.log).toEqual([
      'BEGIN',
      'txn:INSERT INTO match_event',
      'txn:INSERT INTO match_event',
      'txn:INSERT INTO match_event',
      'COMMIT',
    ]);
    expect(fake.calls.map((c) => c.params[2])).toEqual([1, 2, 3]);
  });

  it('appendMany: con un lote vacío no toca la base', async () => {
    await store.appendMany([]);
    expect(fake.log).toEqual([]);
  });

  it('loadEvents: SELECT por partido ordenado por seq', async () => {
    await store.loadEvents('m-9');
    expect(fake.calls).toEqual([
      { via: 'db', sql: expect.stringMatching(/^SELECT .* FROM match_event WHERE match_id = \? ORDER BY seq$/), params: ['m-9'] },
    ]);
  });

  it('markVoided: UPDATE condicionado a voided_at IS NULL; si cambia una fila no consulta nada más', async () => {
    await store.markVoided('m-1', 'e-1', T0 + 3);
    expect(fake.calls).toEqual([
      {
        via: 'db',
        sql: 'UPDATE match_event SET voided_at = ? WHERE id = ? AND match_id = ? AND voided_at IS NULL',
        params: [T0 + 3, 'e-1', 'm-1'],
      },
    ]);
  });

  it('markVoided: sin cambios comprueba existencia; NOT_FOUND si no hay fila, nada si ya estaba anulado', async () => {
    fake.changes = 0;
    fake.firstRow = null;
    const error: unknown = await store.markVoided('m-1', 'e-1', T0).catch((e: unknown) => e);
    expect((error as EventStoreError).code).toBe('NOT_FOUND');
    expect(fake.calls[1]).toEqual({
      via: 'db',
      sql: 'SELECT 1 AS found FROM match_event WHERE id = ? AND match_id = ?',
      params: ['e-1', 'm-1'],
    });

    fake.firstRow = { found: 1 };
    await expect(store.markVoided('m-1', 'e-1', T0)).resolves.toBeUndefined();
  });

  it('updateDerived: una transacción exclusiva con un UPDATE por fila, por txn', async () => {
    await store.updateDerived('m-1', [
      { id: 'a', matchTimeMs: 10, period: 1 },
      { id: 'b', matchTimeMs: 20, period: 2 },
    ]);
    expect(fake.log).toEqual(['BEGIN', 'txn:UPDATE match_event SET', 'txn:UPDATE match_event SET', 'COMMIT']);
    expect(fake.calls).toEqual([
      { via: 'txn', sql: 'UPDATE match_event SET match_time_ms = ?, period = ? WHERE id = ? AND match_id = ?', params: [10, 1, 'a', 'm-1'] },
      { via: 'txn', sql: 'UPDATE match_event SET match_time_ms = ?, period = ? WHERE id = ? AND match_id = ?', params: [20, 2, 'b', 'm-1'] },
    ]);
    fake.log.length = 0;
    await store.updateDerived('m-1', []);
    expect(fake.log).toEqual([]);
  });

  it('lastSeq: COALESCE(MAX(seq), 0) y 0 si no hay fila', async () => {
    expect(await store.lastSeq('m-1')).toBe(0);
    expect(fake.calls[0]).toEqual({
      via: 'db',
      sql: 'SELECT COALESCE(MAX(seq), 0) AS last_seq FROM match_event WHERE match_id = ?',
      params: ['m-1'],
    });
    fake.firstRow = { last_seq: 42 };
    expect(await store.lastSeq('m-1')).toBe(42);
  });
});

/**
 * La prueba más valiosa: el mismo contrato que el almacén en memoria, pero con
 * el SQL ejecutándose en un SQLite real (esquema aplicado con `migrate`).
 */
describeWithSqlite('SqliteEventStore contra SQLite real', () => {
  const opened: NodeSqliteDatabase[] = [];

  afterAll(() => {
    for (const db of opened) db.close();
  });

  describeEventStoreContract('SqliteEventStore', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    return createSqliteEventStore(db, { now: () => T0 });
  });

  it('created_at guarda el instante de escritura inyectado, no el timestamp del evento', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    const store = createSqliteEventStore(db, { now: () => T0 + 123_456 });
    await store.append(makeEvent(1));
    expect(native.prepare('SELECT created_at FROM match_event').get()).toMatchObject({ created_at: T0 + 123_456 });
  });
});
