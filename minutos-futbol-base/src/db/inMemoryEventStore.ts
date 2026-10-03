import type { MatchEvent } from '../core/events';
import { EventStoreError, type EventStore } from './eventStore';

/**
 * EventStore en memoria para tests y desarrollo. Reproduce las reglas del de
 * SQLite (unicidad de id y de (matchId, seq), appendMany todo o nada, orden por
 * seq) para que el MatchEngine se comporte igual con uno u otro.
 */
export interface InMemoryEventStore extends EventStore {
  /** Copia de todos los eventos guardados (de todos los partidos), en orden de inserción. */
  snapshot(): MatchEvent[];
  /** Vacía el almacén. */
  clear(): void;
}

/**
 * Copia por JSON, no structuredClone: Hermes no lo trae y, además, así lo que
 * sale del almacén es exactamente lo que sobreviviría a SQLite (metadata se
 * guarda como JSON). El llamador nunca comparte referencias con lo guardado.
 */
const clone = (event: MatchEvent): MatchEvent => JSON.parse(JSON.stringify(event)) as MatchEvent;

const seqKey = (matchId: string, seq: number): string => JSON.stringify([matchId, seq]);

export function createInMemoryEventStore(): InMemoryEventStore {
  const byId = new Map<string, MatchEvent>();
  const bySeq = new Map<string, MatchEvent>();

  const findInMatch = (matchId: string, eventId: string): MatchEvent | undefined => {
    const event = byId.get(eventId);
    return event && event.matchId === matchId ? event : undefined;
  };

  // Función con nombre (no método con `this`): así `store.append` se puede
  // pasar suelto como callback sin romperse.
  const appendMany: EventStore['appendMany'] = async (events) => {
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
    for (const event of events) {
      const copy = clone(event);
      byId.set(copy.id, copy);
      bySeq.set(seqKey(copy.matchId, copy.seq), copy);
    }
  };

  return {
    append: (event) => appendMany([event]),
    appendMany,

    async loadEvents(matchId) {
      return [...byId.values()]
        .filter((event) => event.matchId === matchId)
        .sort((a, b) => a.seq - b.seq)
        .map(clone);
    },

    async markVoided(matchId, eventId, voidedAt) {
      const event = findInMatch(matchId, eventId);
      if (!event) throw new EventStoreError('NOT_FOUND', `Evento ${eventId} no existe en el partido ${matchId}`);
      // Idempotente: se conserva el primer instante de anulación.
      if (event.voidedAt == null) event.voidedAt = voidedAt;
    },

    async updateDerived(matchId, updates) {
      for (const update of updates) {
        const event = findInMatch(matchId, update.id);
        if (!event) continue;
        event.matchTimeMs = update.matchTimeMs;
        event.period = update.period;
      }
    },

    async lastSeq(matchId) {
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
    },
  };
}
