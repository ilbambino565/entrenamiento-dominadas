import { createInMemorySquadRepository } from '../../db/inMemorySquadRepository';
import type { KeyValueStorage, SquadRepository } from '../../db/squadRepository';

/**
 * Persistencia de la plantilla en WEB: en memoria con copia en `localStorage`
 * si existe. Misma firma que la variante nativa (`openSquadRepository.ts`);
 * Metro la elige para la plataforma web y el paquete web no arrastra
 * `expo-sqlite`. Con el almacenamiento bloqueado (navegación privada,
 * política del navegador) el propio acceso a `localStorage` puede lanzar: en
 * ese caso la plantilla vive solo en memoria mientras dure la pestaña.
 */
export function webStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function openSquadRepository(): Promise<SquadRepository> {
  const storage = webStorage();
  return createInMemorySquadRepository(storage ? { storage } : {});
}
