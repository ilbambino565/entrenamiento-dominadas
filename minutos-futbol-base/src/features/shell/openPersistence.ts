import { createSqliteEventStore } from '../../db/sqliteEventStore';
import { createSqliteFixtureRepository } from '../../db/sqliteFixtureRepository';
import { createSqliteMatchRepository } from '../../db/sqliteMatchRepository';
import { createSqliteSquadRepository } from '../../db/sqliteSquadRepository';
import type { Persistence } from './persistence';

/**
 * Persistencia en NATIVO: SQLite. La variante web vive en
 * `openPersistence.web.ts` y Metro elige por extensión de plataforma:
 * así `expo-sqlite` ni siquiera entra en el paquete web (su worker wasm no
 * se resuelve sin configuración extra y rompería `expo export --platform
 * web`). El import de `db/client` es perezoso, dentro de la función: es el
 * único módulo que carga `expo-sqlite` en ejecución y solo debe hacerlo al
 * abrir la base. `openAppDatabase` fija los PRAGMAs y migra (hasta SCHEMA_VERSION).
 */
export async function openPersistence(): Promise<Persistence> {
  const { openAppDatabase } = await import('../../db/client');
  const db = await openAppDatabase();
  return {
    squad: createSqliteSquadRepository(db),
    matches: createSqliteMatchRepository(db),
    fixtures: createSqliteFixtureRepository(db),
    events: createSqliteEventStore(db),
  };
}
