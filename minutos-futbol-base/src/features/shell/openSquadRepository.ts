import { createSqliteSquadRepository } from '../../db/sqliteSquadRepository';
import type { SquadRepository } from '../../db/squadRepository';

/**
 * Persistencia de la plantilla en NATIVO: SQLite. La variante web vive en
 * `openSquadRepository.web.ts` y Metro elige por extensión de plataforma:
 * así `expo-sqlite` ni siquiera entra en el paquete web (su worker wasm no
 * se resuelve sin configuración extra y rompería `expo export --platform
 * web`). El import de `db/client` es perezoso, dentro de la función: es el
 * único módulo que carga `expo-sqlite` en ejecución y solo debe hacerlo al
 * abrir la base. `openAppDatabase` fija los PRAGMAs y migra (user_version 2).
 */
export async function openSquadRepository(): Promise<SquadRepository> {
  const { openAppDatabase } = await import('../../db/client');
  return createSqliteSquadRepository(await openAppDatabase());
}
