import type { SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS, type Migration } from './schema';

/**
 * Aplica las migraciones pendientes según `PRAGMA user_version`.
 *
 * Cada migración va en su propia transacción exclusiva junto con la escritura
 * de `user_version`: en SQLite el DDL y ese pragma son transaccionales, así que
 * un cierre forzoso a mitad deja la base en la versión anterior, completa, y
 * la siguiente apertura la retoma desde ahí.
 *
 * Solo importa tipos de expo-sqlite para poder probarse con un doble (y por
 * eso vive separado de `client.ts`, el único que lo importa en ejecución).
 */
export async function migrate(db: SQLiteDatabase, migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latest) {
    // Base escrita por una versión más nueva de la app: seguir sería usar un
    // esquema que no conocemos y arriesgar los datos del partido.
    throw new Error(`Base de datos en versión ${current}, superior a la soportada (${latest})`);
  }

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (!Number.isInteger(migration.version)) throw new Error(`Versión de migración inválida: ${migration.version}`);
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const statement of migration.statements) await txn.execAsync(statement);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    current = migration.version;
  }
}
