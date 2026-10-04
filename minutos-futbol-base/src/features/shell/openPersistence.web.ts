import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { createInMemoryMatchRepository } from '../../db/inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../../db/inMemorySquadRepository';
import type { KeyValueStorage } from '../../db/squadRepository';
import type { Persistence } from './persistence';

/**
 * Persistencia en WEB: plantilla, partidos y timeline en memoria con copia en
 * `localStorage` si existe (no hay SQLite en web): cada escritura se confirma en
 * el storage antes de mostrarse, y al recargar la página el partido en curso se
 * recupera (P0). La plantilla va en una clave, los partidos en otra y la
 * timeline en una por partido. Misma firma que la variante nativa
 * (`openPersistence.ts`); Metro la elige para la plataforma web y el paquete
 * web no arrastra `expo-sqlite`. Con el almacenamiento bloqueado (navegación
 * privada, política del navegador) el propio acceso a `localStorage` puede
 * lanzar: en ese caso todo vive solo en memoria mientras dure la pestaña. Si el
 * almacenamiento se llena, guardar rechaza y el partido avisa en vez de seguir
 * sin red: la cuota de `localStorage` (~5 MB) la comen sobre todo las fotos de
 * la plantilla.
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
    matches: createInMemoryMatchRepository(storage ? { storage } : {}),
    events: createInMemoryEventStore(storage ? { storage } : {}),
  };
}
