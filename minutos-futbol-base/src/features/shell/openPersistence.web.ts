import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { createInMemoryFixtureRepository } from '../../db/inMemoryFixtureRepository';
import { createInMemoryMatchRepository } from '../../db/inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../../db/inMemorySquadRepository';
import type { KeyValueStorage } from '../../db/squadRepository';
import type { Persistence } from './persistence';

/**
 * Persistencia en WEB: plantilla, partidos y timeline en memoria con copia en
 * `localStorage` si existe (no hay SQLite en web): cada escritura se confirma en
 * el storage antes de mostrarse, y al recargar la página el partido en curso se
 * recupera (P0). La plantilla va en una clave, los partidos en otra, el
 * calendario en otra y la timeline en una por partido. Misma firma que la variante nativa
 * (`openPersistence.ts`); Metro la elige para la plataforma web y el paquete
 * web no arrastra `expo-sqlite`. Con el almacenamiento bloqueado (navegación
 * privada, política del navegador) el propio acceso a `localStorage` puede
 * lanzar: en ese caso todo vive solo en memoria mientras dure la pestaña. Si el
 * almacenamiento se llena, guardar rechaza y el partido avisa en vez de seguir
 * sin red: la cuota de `localStorage` (~5 MB) la comen sobre todo las fotos de
 * la plantilla.
 */
const PROBE_KEY = 'minutos-futbol-base.probe';

/**
 * `localStorage` solo vale si además deja ESCRIBIR: en navegación privada de
 * algunos navegadores, con la cuota agotada o con los datos de sitio
 * bloqueados, el objeto existe pero `setItem` lanza. Si se descubriera en la
 * primera escritura, la siembra del paquete fallaría y el entrenador vería el
 * primer arranque vacío en vez de su plantilla; mejor saberlo ahora y
 * quedarse en memoria.
 */
export function webStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem(PROBE_KEY, '1');
    if (typeof localStorage.removeItem === 'function') localStorage.removeItem(PROBE_KEY);
    return localStorage;
  } catch {
    return null;
  }
}

export async function openPersistence(): Promise<Persistence> {
  const storage = webStorage();
  return {
    squad: createInMemorySquadRepository(storage ? { storage } : {}),
    matches: createInMemoryMatchRepository(storage ? { storage } : {}),
    fixtures: createInMemoryFixtureRepository(storage ? { storage } : {}),
    events: createInMemoryEventStore(storage ? { storage } : {}),
  };
}
