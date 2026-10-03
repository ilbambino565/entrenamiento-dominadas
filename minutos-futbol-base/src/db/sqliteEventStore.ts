import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type { MatchEvent } from '../core/events';
import { EventStoreError, type EventStore } from './eventStore';
import { eventToRow, rowToEvent, type MatchEventRow } from './mappers';

/**
 * EventStore sobre expo-sqlite. Una transacción por llamada; cuando una
 * promesa resuelve, el evento está confirmado en disco (WAL + synchronous=FULL,
 * ver `client.ts`) y solo entonces el MatchEngine actualiza la pantalla.
 */

export interface SqliteEventStoreOptions {
  /** Reloj para `created_at` (instante de escritura). Inyectable para tests. */
  now?: () => number;
}

const COLUMNS =
  'id, match_id, seq, type, timestamp, match_time_ms, period, player_id, secondary_player_id, metadata, source, voided_at, created_at';

const INSERT_SQL = `INSERT INTO match_event (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT_BY_MATCH_SQL = `SELECT ${COLUMNS} FROM match_event WHERE match_id = ? ORDER BY seq`;
const MARK_VOIDED_SQL = 'UPDATE match_event SET voided_at = ? WHERE id = ? AND match_id = ? AND voided_at IS NULL';
const EXISTS_SQL = 'SELECT 1 AS found FROM match_event WHERE id = ? AND match_id = ?';
const UPDATE_DERIVED_SQL = 'UPDATE match_event SET match_time_ms = ?, period = ? WHERE id = ? AND match_id = ?';
const LAST_SEQ_SQL = 'SELECT COALESCE(MAX(seq), 0) AS last_seq FROM match_event WHERE match_id = ?';

/** Parámetros posicionales en el MISMO orden que `COLUMNS`. */
function insertParams(row: MatchEventRow): SQLiteBindValue[] {
  return [
    row.id,
    row.match_id,
    row.seq,
    row.type,
    row.timestamp,
    row.match_time_ms,
    row.period,
    row.player_id,
    row.secondary_player_id,
    row.metadata,
    row.source,
    row.voided_at,
    row.created_at,
  ];
}

/**
 * Traduce errores del driver al contrato del puerto. La violación de UNIQUE
 * (de `(match_id, seq)` o de la clave primaria) es la única que el motor
 * trata de forma especial; el resto se envuelve con su causa para diagnosticar.
 */
function toStoreError(error: unknown, operation: string): EventStoreError {
  if (error instanceof EventStoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes('UNIQUE') ? 'DUPLICATE_SEQ' : 'STORAGE';
  return new EventStoreError(code, `${operation}: ${message}`, error);
}

async function guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toStoreError(error, operation);
  }
}

export function createSqliteEventStore(db: SQLiteDatabase, options: SqliteEventStoreOptions = {}): EventStore {
  const now = options.now ?? Date.now;

  return {
    // Un INSERT ya es atómico; la transacción explícita va en la conexión
    // principal (la que tiene synchronous=FULL) y deja claro el punto de
    // durabilidad. No se usa la exclusiva: abrir una conexión por gesto sobra.
    append: (event) =>
      guarded('append', () =>
        db.withTransactionAsync(async () => {
          await db.runAsync(INSERT_SQL, insertParams(eventToRow(event, now())));
        }),
      ),

    appendMany: (events) => {
      if (events.length === 0) return Promise.resolve();
      return guarded('appendMany', () =>
        // Todo o nada: si una fila falla, expo-sqlite hace ROLLBACK del lote.
        // Dentro de la exclusiva hay que usar `txn`, nunca `db` (se bloquearía).
        db.withExclusiveTransactionAsync(async (txn) => {
          const createdAt = now();
          for (const event of events) await txn.runAsync(INSERT_SQL, insertParams(eventToRow(event, createdAt)));
        }),
      );
    },

    loadEvents: (matchId) =>
      guarded('loadEvents', async () => {
        const rows = await db.getAllAsync<MatchEventRow>(SELECT_BY_MATCH_SQL, [matchId]);
        return rows.map(rowToEvent);
      }),

    markVoided: (matchId, eventId, voidedAt) =>
      guarded('markVoided', async () => {
        const result = await db.runAsync(MARK_VOIDED_SQL, [voidedAt, eventId, matchId]);
        if (result.changes > 0) return;
        // Sin cambios: o no existe, o ya estaba anulado (idempotente: se
        // conserva el primer instante de anulación).
        const row = await db.getFirstAsync<{ found: number }>(EXISTS_SQL, [eventId, matchId]);
        if (!row) throw new EventStoreError('NOT_FOUND', `Evento ${eventId} no existe en el partido ${matchId}`);
      }),

    updateDerived: (matchId, updates) => {
      if (updates.length === 0) return Promise.resolve();
      return guarded('updateDerived', () =>
        db.withExclusiveTransactionAsync(async (txn) => {
          // Ids desconocidos no actualizan nada y no son un error: el motor
          // manda solo los que cambian y puede incluir alguno ya anulado.
          for (const u of updates) await txn.runAsync(UPDATE_DERIVED_SQL, [u.matchTimeMs, u.period, u.id, matchId]);
        }),
      );
    },

    lastSeq: (matchId) =>
      guarded('lastSeq', async () => {
        const row = await db.getFirstAsync<{ last_seq: number }>(LAST_SEQ_SQL, [matchId]);
        return row?.last_seq ?? 0;
      }),
  };
}
