import type { EventSource, MatchEvent } from '../core/events';
import { isMatchEventType } from '../core/events';
import { EventStoreError } from './eventStore';

/** Fila de `match_event` tal y como la devuelve SQLite (columnas en snake_case). */
export interface MatchEventRow {
  id: string;
  match_id: string;
  seq: number;
  type: string;
  timestamp: number;
  match_time_ms: number;
  period: number;
  player_id: string | null;
  secondary_player_id: string | null;
  /** `metadata` serializado como JSON. */
  metadata: string;
  source: string;
  voided_at: number | null;
  created_at: number;
}

const EVENT_SOURCES = ['user', 'system', 'camera'] as const satisfies readonly EventSource[];

/**
 * Evento → fila. `createdAt` es el instante de escritura, distinto de
 * `timestamp` (el instante del hecho, capturado en el gesto). Se inyecta para
 * que el mapper sea determinista; por defecto coincide con `timestamp`.
 */
export function eventToRow(event: MatchEvent, createdAt: number = event.timestamp): MatchEventRow {
  return {
    id: event.id,
    match_id: event.matchId,
    seq: event.seq,
    type: event.type,
    timestamp: event.timestamp,
    match_time_ms: event.matchTimeMs,
    period: event.period,
    player_id: event.playerId,
    secondary_player_id: event.secondaryPlayerId,
    metadata: JSON.stringify(event.metadata),
    source: event.source,
    voided_at: event.voidedAt,
    created_at: createdAt,
  };
}

/**
 * Fila → evento. Una fila corrupta (tipo u origen desconocidos, JSON inválido)
 * lanza EventStoreError 'STORAGE' en lugar de colarse en el dominio, donde
 * rompería la regeneración del partido con un error mucho menos claro.
 */
export function rowToEvent(row: MatchEventRow): MatchEvent {
  if (!isMatchEventType(row.type)) throw corrupt(row, `tipo desconocido "${row.type}"`);
  if (!(EVENT_SOURCES as readonly string[]).includes(row.source)) {
    throw corrupt(row, `source desconocido "${row.source}"`);
  }
  // Un NaN o un null donde va un número contaminaría todo el reloj del partido.
  const numeric: Array<[string, unknown]> = [
    ['seq', row.seq],
    ['timestamp', row.timestamp],
    ['match_time_ms', row.match_time_ms],
    ['period', row.period],
  ];
  if (row.voided_at != null) numeric.push(['voided_at', row.voided_at]);
  for (const [column, value] of numeric) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw corrupt(row, `${column} no es un número finito`);
  }
  return {
    id: row.id,
    matchId: row.match_id,
    seq: row.seq,
    type: row.type,
    timestamp: row.timestamp,
    matchTimeMs: row.match_time_ms,
    period: row.period,
    playerId: row.player_id ?? null,
    secondaryPlayerId: row.secondary_player_id ?? null,
    metadata: parseMetadata(row),
    source: row.source as EventSource,
    voidedAt: row.voided_at ?? null,
  };
}

function parseMetadata(row: MatchEventRow): MatchEvent['metadata'] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.metadata);
  } catch (error) {
    throw corrupt(row, 'metadata no es JSON válido', error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw corrupt(row, 'metadata no es un objeto');
  }
  return parsed as MatchEvent['metadata'];
}

function corrupt(row: MatchEventRow, reason: string, cause?: unknown): EventStoreError {
  return new EventStoreError('STORAGE', `Fila corrupta en match_event (id=${row.id}): ${reason}`, cause);
}
