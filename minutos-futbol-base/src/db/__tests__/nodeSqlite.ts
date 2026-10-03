import type { SQLiteBindParams, SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

/**
 * Acceso a `node:sqlite` (Node >= 22) desde Jest, para probar el SQL de verdad.
 *
 * - Se carga con `process.getBuiltinModule` y no con `require`: el runtime de
 *   Jest recorta el prefijo `node:` y `sqlite` sin prefijo no existe.
 * - Los tipos van declarados a mano (solo lo que usamos): `@types/node` no
 *   está en `types` del tsconfig y no queremos depender de ello.
 */
export interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    const loader = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process
      ?.getBuiltinModule;
    const mod = loader?.('node:sqlite') as NodeSqliteModule | undefined;
    return mod?.DatabaseSync ? mod : null;
  } catch {
    return null;
  }
}

export const nodeSqlite = loadNodeSqlite();

if (!nodeSqlite) {
  console.warn('node:sqlite no disponible (Node >= 22 con el módulo experimental): se saltan los tests contra SQLite real');
}

/** `describe` que se salta cuando no hay SQLite real en el entorno. */
export const describeWithSqlite = nodeSqlite ? describe : describe.skip;

export function openMemoryDatabase(): NodeSqliteDatabase {
  if (!nodeSqlite) throw new Error('node:sqlite no disponible');
  return new nodeSqlite.DatabaseSync(':memory:');
}

const asArray = (params: SQLiteBindParams | undefined): unknown[] => (Array.isArray(params) ? params : []);

/**
 * Doble de `SQLiteDatabase` (expo-sqlite) que ejecuta contra `node:sqlite`.
 * Imita las semánticas que usa el código de producción: BEGIN/COMMIT/ROLLBACK
 * automáticos en las transacciones y `txn` como objeto de la exclusiva.
 * Solo implementa los métodos que usamos; el cast lo deja claro.
 */
export function createNodeSqliteDouble(native: NodeSqliteDatabase): SQLiteDatabase {
  const transaction = async (task: () => Promise<void>) => {
    native.exec('BEGIN');
    try {
      await task();
      native.exec('COMMIT');
    } catch (error) {
      native.exec('ROLLBACK');
      throw error;
    }
  };

  const double = {
    async execAsync(source: string): Promise<void> {
      native.exec(source);
    },
    async runAsync(source: string, params?: SQLiteBindParams): Promise<SQLiteRunResult> {
      const result = native.prepare(source).run(...asArray(params));
      return { changes: Number(result.changes), lastInsertRowId: 0 };
    },
    async getAllAsync<T>(source: string, params?: SQLiteBindParams): Promise<T[]> {
      return native.prepare(source).all(...asArray(params)) as T[];
    },
    async getFirstAsync<T>(source: string, params?: SQLiteBindParams): Promise<T | null> {
      return (native.prepare(source).get(...asArray(params)) as T | undefined) ?? null;
    },
    withTransactionAsync: (task: () => Promise<void>) => transaction(task),
    withExclusiveTransactionAsync: (task: (txn: SQLiteDatabase) => Promise<void>) => transaction(() => task(db)),
  };
  const db = double as unknown as SQLiteDatabase;
  return db;
}
