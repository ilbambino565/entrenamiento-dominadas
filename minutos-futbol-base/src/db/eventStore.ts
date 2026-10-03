import type { DerivedFieldsUpdate } from '../core/derive';
import type { MatchEvent } from '../core/events';

/**
 * Puerto de persistencia de la timeline.
 *
 * Contrato de durabilidad: cuando `append` resuelve, el evento está en disco.
 * El MatchEngine solo actualiza la pantalla DESPUÉS de que resuelva.
 *
 * Implementaciones:
 * - InMemoryEventStore: tests y desarrollo.
 * - SqliteEventStore: expo-sqlite (WAL, synchronous=FULL), una transacción
 *   por llamada.
 */
export interface EventStore {
  /** Inserta un evento. Falla si (matchId, seq) ya existe. */
  append(event: MatchEvent): Promise<void>;

  /** Inserta varios eventos en una única transacción (todo o nada). */
  appendMany(events: readonly MatchEvent[]): Promise<void>;

  /** Todos los eventos del partido (anulados incluidos) ordenados por `seq`. */
  loadEvents(matchId: string): Promise<MatchEvent[]>;

  /** Marca un evento como anulado (DESHACER). Idempotente. */
  markVoided(matchId: string, eventId: string, voidedAt: number): Promise<void>;

  /**
   * Actualiza los campos derivados (`matchTimeMs`, `period`) tras regenerar las
   * proyecciones. No toca `timestamp` ni `metadata`.
   */
  updateDerived(matchId: string, updates: readonly DerivedEventFields[]): Promise<void>;

  /** Último `seq` usado en el partido (0 si no hay eventos). */
  lastSeq(matchId: string): Promise<number>;
}

/** Lo que produce `changedDerivedFields` (core) se persiste tal cual. */
export type DerivedEventFields = DerivedFieldsUpdate;

export class EventStoreError extends Error {
  constructor(
    public readonly code: 'DUPLICATE_SEQ' | 'NOT_FOUND' | 'STORAGE',
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EventStoreError';
  }
}
