import type { MatchEvent } from '../core/events';
import { EventStoreError, type EventStore } from './eventStore';
import { eventToRow, rowToEvent, type MatchEventRow } from './mappers';
import type { KeyValueStorage } from './squadRepository';

/**
 * EventStore en memoria para tests, desarrollo y la web. Reproduce las reglas
 * del de SQLite (unicidad de id y de (matchId, seq), appendMany todo o nada,
 * orden por seq) para que el MatchEngine se comporte igual con uno u otro.
 *
 * Con `storage` (web: localStorage) cada partido se guarda en su propia clave,
 * `<storageKey>.<matchId>`, como `{ version, events: MatchEventRow[] }`, y se
 * lee de forma perezosa la primera vez que se toca. Cada escritura reescribe
 * solo la clave de ese partido y va ANTES de tocar la memoria: si el storage
 * falla (cuota llena, bloqueado), la promesa rechaza con 'STORAGE' y nada
 * cambia, igual que una transacción de SQLite; así el motor no muestra en
 * pantalla un evento que no está guardado. Un partido cuyo JSON no se puede
 * interpretar NO se descarta ni se pisa: sus lecturas y escrituras rechazan
 * con 'STORAGE' (la timeline es la verdad; mejor un partido que no abre que
 * uno vaciado). Un `appendMany` con eventos de VARIOS partidos escribe de uno en
 * uno y no es atómico entre ellos; el motor siempre escribe de uno solo.
 */
export interface InMemoryEventStore extends EventStore {
  /** Copia de todos los eventos guardados (de todos los partidos cargados), en orden de inserción. */
  snapshot(): MatchEvent[];
  /** Vacía la memoria (no toca el storage). */
  clear(): void;
}

export interface InMemoryEventStoreOptions {
  storage?: KeyValueStorage;
  storageKey?: string;
}

export const DEFAULT_EVENTS_STORAGE_KEY = 'minutos-futbol-base.events.v1';
export const EVENTS_STORAGE_VERSION = 1;

/** Forma del JSON guardado en el storage para un partido. */
export interface StoredMatchEvents {
  version: typeof EVENTS_STORAGE_VERSION;
  events: MatchEventRow[];
}

/**
 * Copia por JSON, no structuredClone: Hermes no lo trae y, además, así lo que
 * sale del almacén es exactamente lo que sobreviviría a SQLite (metadata se
 * guarda como JSON). El llamador nunca comparte referencias con lo guardado.
 */
const clone = (event: MatchEvent): MatchEvent => JSON.parse(JSON.stringify(event)) as MatchEvent;

const seqKey = (matchId: string, seq: number): string => JSON.stringify([matchId, seq]);

const storageError = (message: string, cause: unknown): EventStoreError =>
  new EventStoreError('STORAGE', `${message}: ${cause instanceof Error ? cause.message : String(cause)}`, cause);

function parseStored(raw: string, matchId: string): MatchEvent[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('no es un objeto');
  const stored = parsed as Partial<StoredMatchEvents>;
  if (stored.version !== EVENTS_STORAGE_VERSION) throw new Error(`versión desconocida (${String(stored.version)})`);
  if (!Array.isArray(stored.events)) throw new Error('events no es una lista');
  return stored.events.map((row) => {
    const event = rowToEvent(row);
    if (event.matchId !== matchId) throw new Error(`el evento ${event.id} es de otro partido`);
    return event;
  });
}

export function createInMemoryEventStore(options: InMemoryEventStoreOptions = {}): InMemoryEventStore {
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? DEFAULT_EVENTS_STORAGE_KEY;
  const byId = new Map<string, MatchEvent>();
  const bySeq = new Map<string, MatchEvent>();
  /** Partidos ya leídos del storage (sin storage, todo está "cargado"). */
  const loaded = new Set<string>();

  const keyOf = (matchId: string): string => `${storageKey}.${matchId}`;
  const eventsOf = (matchId: string): MatchEvent[] => [...byId.values()].filter((event) => event.matchId === matchId);
  const insert = (event: MatchEvent): void => {
    byId.set(event.id, event);
    bySeq.set(seqKey(event.matchId, event.seq), event);
  };

  /** Lee el partido del storage la primera vez. Un storage ilegible o un JSON ininterpretable rechazan sin tocar nada. */
  const ensureLoaded = (matchId: string): void => {
    if (!storage || loaded.has(matchId)) return;
    let raw: string | null;
    try {
      raw = storage.getItem(keyOf(matchId));
    } catch (error) {
      throw storageError('No se pudo leer la timeline del partido', error);
    }
    if (raw !== null) {
      let events: MatchEvent[];
      try {
        events = parseStored(raw, matchId);
      } catch (error) {
        // Solo el tipo del error: el mensaje de JSON.parse incluye un trozo del texto.
        throw new EventStoreError('STORAGE', `La timeline guardada del partido ${matchId} no se puede interpretar (${error instanceof Error ? error.name : 'error'})`, error);
      }
      for (const event of events) insert(event);
    }
    loaded.add(matchId);
  };

  /** Escribe la lista completa del partido en su clave. Con storage, antes de tocar la memoria. */
  const persist = (matchId: string, events: readonly MatchEvent[]): void => {
    if (!storage) return;
    const stored: StoredMatchEvents = {
      version: EVENTS_STORAGE_VERSION,
      events: [...events].sort((a, b) => a.seq - b.seq).map((event) => eventToRow(event)),
    };
    try {
      storage.setItem(keyOf(matchId), JSON.stringify(stored));
    } catch (error) {
      throw storageError('No se pudo guardar la timeline del partido', error);
    }
  };

  const findInMatch = (matchId: string, eventId: string): MatchEvent | undefined => {
    const event = byId.get(eventId);
    return event && event.matchId === matchId ? event : undefined;
  };

  // Función con nombre (no método con `this`): así `store.append` se puede
  // pasar suelto como callback sin romperse.
  const appendMany: EventStore['appendMany'] = async (events) => {
    const matchIds = [...new Set(events.map((event) => event.matchId))];
    for (const matchId of matchIds) ensureLoaded(matchId);
    // Se valida TODO el lote (contra lo guardado y contra sí mismo) antes de
    // insertar nada: en SQLite la transacción haría rollback; aquí no hay
    // transacción, así que la atomicidad se consigue no empezando.
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const event of events) {
      const key = seqKey(event.matchId, event.seq);
      if (byId.has(event.id) || ids.has(event.id)) {
        throw new EventStoreError('DUPLICATE_SEQ', `El evento ${event.id} ya existe`);
      }
      if (bySeq.has(key) || keys.has(key)) {
        throw new EventStoreError('DUPLICATE_SEQ', `seq ${event.seq} ya usado en el partido ${event.matchId}`);
      }
      ids.add(event.id);
      keys.add(key);
    }
    const copies = events.map(clone);
    for (const matchId of matchIds) {
      persist(matchId, [...eventsOf(matchId), ...copies.filter((event) => event.matchId === matchId)]);
      for (const copy of copies) if (copy.matchId === matchId) insert(copy);
    }
  };

  return {
    append: (event) => appendMany([event]),
    appendMany,

    async loadEvents(matchId) {
      ensureLoaded(matchId);
      return eventsOf(matchId)
        .sort((a, b) => a.seq - b.seq)
        .map(clone);
    },

    async markVoided(matchId, eventId, voidedAt) {
      ensureLoaded(matchId);
      const event = findInMatch(matchId, eventId);
      if (!event) throw new EventStoreError('NOT_FOUND', `Evento ${eventId} no existe en el partido ${matchId}`);
      // Idempotente: se conserva el primer instante de anulación.
      if (event.voidedAt != null) return;
      persist(matchId, eventsOf(matchId).map((e) => (e === event ? { ...e, voidedAt } : e)));
      event.voidedAt = voidedAt;
    },

    async updateDerived(matchId, updates) {
      ensureLoaded(matchId);
      const changes = new Map<MatchEvent, { matchTimeMs: number; period: number }>();
      for (const update of updates) {
        const event = findInMatch(matchId, update.id);
        if (event) changes.set(event, { matchTimeMs: update.matchTimeMs, period: update.period });
      }
      if (changes.size === 0) return;
      persist(matchId, eventsOf(matchId).map((e) => ({ ...e, ...(changes.get(e) ?? {}) })));
      for (const [event, derived] of changes) {
        event.matchTimeMs = derived.matchTimeMs;
        event.period = derived.period;
      }
    },

    async lastSeq(matchId) {
      ensureLoaded(matchId);
      let last = 0;
      for (const event of byId.values()) {
        if (event.matchId === matchId && event.seq > last) last = event.seq;
      }
      return last;
    },

    snapshot() {
      return [...byId.values()].map(clone);
    },

    clear() {
      byId.clear();
      bySeq.clear();
      loaded.clear();
    },
  };
}
