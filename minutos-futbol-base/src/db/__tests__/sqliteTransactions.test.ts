import type { SQLiteBindParams, SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import { openDatabaseAsync } from 'expo-sqlite';
import { DEFAULT_DATABASE_NAME, openAppDatabase } from '../client';
import { migrate } from '../migrate';
import { DB_PRAGMAS, MIGRATIONS } from '../schema';

/**
 * Revisión de compatibilidad con expo-sqlite 57.
 *
 * Dos comportamientos del driver que el doble sobre `node:sqlite` NO puede
 * detectar (pasa el mismo objeto como `db` y como `txn`):
 *
 * 1. `withExclusiveTransactionAsync` abre OTRA conexión y ejecuta `BEGIN` antes
 *    de llamar a la tarea. Dentro hay que usar `txn`: una sentencia por `db`
 *    iría a la conexión principal (fuera de la transacción) o se bloquearía.
 * 2. `PRAGMA journal_mode` no tiene efecto dentro de una transacción, así que
 *    los PRAGMAs tienen que ejecutarse en la conexión principal, antes de
 *    `migrate` y sin BEGIN por medio.
 *
 * `expo-sqlite` se sustituye con una fábrica para no cargar el módulo nativo.
 */
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

interface Call {
  via: 'db' | 'txn';
  sql: string;
}

function createRecordingDb() {
  const log: string[] = [];
  const calls: Call[] = [];

  const executor = (via: 'db' | 'txn') => ({
    async execAsync(sql: string): Promise<void> {
      calls.push({ via, sql });
      log.push(`${via}:${sql.split(/\s+/).slice(0, 2).join(' ')}`);
    },
    async runAsync(sql: string, _params?: SQLiteBindParams): Promise<SQLiteRunResult> {
      calls.push({ via, sql });
      return { changes: 1, lastInsertRowId: 0 };
    },
    async getAllAsync(sql: string, _params?: SQLiteBindParams): Promise<unknown[]> {
      calls.push({ via, sql });
      return [];
    },
    async getFirstAsync(sql: string, _params?: SQLiteBindParams): Promise<unknown> {
      calls.push({ via, sql });
      return sql === 'PRAGMA user_version' ? { user_version: 0 } : null;
    },
  });

  const txn = executor('txn') as unknown as SQLiteDatabase;
  const db = {
    ...executor('db'),
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      log.push('BEGIN');
      await task();
      log.push('COMMIT');
    },
    async withExclusiveTransactionAsync(task: (t: SQLiteDatabase) => Promise<void>): Promise<void> {
      log.push('BEGIN(exclusive)');
      await task(txn);
      log.push('COMMIT(exclusive)');
    },
  } as unknown as SQLiteDatabase;

  return { db, log, calls };
}

describe('review-compat-expo: openAppDatabase', () => {
  it('abre la base con el nombre por defecto y aplica los PRAGMAs en la conexión principal, fuera de toda transacción y antes de migrar', async () => {
    const fake = createRecordingDb();
    jest.mocked(openDatabaseAsync).mockResolvedValue(fake.db);

    const db = await openAppDatabase();

    expect(db).toBe(fake.db);
    expect(openDatabaseAsync).toHaveBeenCalledWith(DEFAULT_DATABASE_NAME);

    // Los PRAGMAs van por `db` (execAsync), en el orden de DB_PRAGMAS, y son lo
    // primero que se ejecuta: journal_mode dentro de un BEGIN no haría nada.
    const pragmas = fake.calls.slice(0, DB_PRAGMAS.length);
    expect(pragmas).toEqual(DB_PRAGMAS.map((sql) => ({ via: 'db', sql })));
    const firstBegin = fake.log.findIndex((entry) => entry.startsWith('BEGIN'));
    const lastPragma = fake.log.lastIndexOf('db:PRAGMA journal_mode');
    expect(lastPragma).toBeGreaterThanOrEqual(0);
    expect(firstBegin === -1 || firstBegin > DB_PRAGMAS.length - 1).toBe(true);

    // Después de los PRAGMAs llega la migración (lectura de user_version por db).
    expect(fake.calls[DB_PRAGMAS.length]).toEqual({ via: 'db', sql: 'PRAGMA user_version' });
  });
});

describe('review-compat-expo: migrate', () => {
  it('ejecuta todas las sentencias y el PRAGMA user_version por `txn`, nunca por `db`, dentro de la exclusiva', async () => {
    const fake = createRecordingDb();
    await migrate(fake.db);

    const viaDb = fake.calls.filter((c) => c.via === 'db').map((c) => c.sql);
    const viaTxn = fake.calls.filter((c) => c.via === 'txn').map((c) => c.sql);

    // Por la conexión principal solo la lectura de la versión actual.
    expect(viaDb).toEqual(['PRAGMA user_version']);

    // Por la conexión de la transacción: cada migración entera + su user_version.
    const expected = MIGRATIONS.flatMap((m) => [...m.statements, `PRAGMA user_version = ${m.version}`]);
    expect(viaTxn).toEqual(expected);

    // Una transacción exclusiva por migración, y nada fuera de ellas.
    const begins = fake.log.filter((e) => e === 'BEGIN(exclusive)').length;
    expect(begins).toBe(MIGRATIONS.length);
    expect(fake.log.filter((e) => e === 'BEGIN').length).toBe(0);
  });
});
