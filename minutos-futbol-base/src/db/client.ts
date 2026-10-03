import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { DB_PRAGMAS } from './schema';
import { migrate } from './migrate';

export const DEFAULT_DATABASE_NAME = 'minutos-futbol-base.db';

/**
 * Abre (o crea) la base de la app, fija los PRAGMAs y migra. Es el único
 * punto del código que importa `expo-sqlite` en ejecución: todo lo demás
 * recibe el `SQLiteDatabase` ya abierto (inyectable en tests).
 *
 * Los PRAGMAs se aplican a ESTA conexión. `withExclusiveTransactionAsync` abre
 * una conexión nueva por transacción que no los hereda: `journal_mode=WAL`
 * persiste en el archivo, y `synchronous` vuelve al valor de compilación del
 * SQLite que empaqueta expo-sqlite (FULL), pero `foreign_keys` queda apagado
 * dentro de esas transacciones. Ver `DB_PRAGMAS` para el porqué de WAL + FULL.
 */
export async function openAppDatabase(name: string = DEFAULT_DATABASE_NAME): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(name);
  for (const pragma of DB_PRAGMAS) await db.execAsync(pragma);
  await migrate(db);
  return db;
}
