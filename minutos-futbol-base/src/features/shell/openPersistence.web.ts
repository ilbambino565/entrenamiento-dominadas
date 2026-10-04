import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { createInMemoryMatchRepository } from '../../db/inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../../db/inMemorySquadRepository';
import type { KeyValueStorage } from '../../db/squadRepository';
import type { Persistence } from './persistence';

/**
 * Persistencia en WEB: la plantilla en memoria con copia en `localStorage` si
 * existe; partidos y timeline solo en memoria (no hay SQLite en web: se
 * pierden al recargar la página). Misma firma que la variante nativa
 * (`openPersistence.ts`); Metro la elige para la plataforma web y el paquete
 * web no arrastra `expo-sqlite`. Con el almacenamiento bloqueado (navegación
 * privada, política del navegador) el propio acceso a `localStorage` puede
 * lanzar: en ese caso la plantilla vive solo en memoria mientras dure la pestaña.
 */
export function webStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function openPersistence(): Promise<Persistence> {
  const storage = webStorage();
  return {
    squad: createInMemorySquadRepository(storage ? { storage } : {}),
    matches: createInMemoryMatchRepository(),
    events: createInMemoryEventStore(),
  };
}
