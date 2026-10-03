/**
 * TIMELINE DEL PARTIDO: modelo genérico de evento.
 *
 * Todo lo que ocurre en un partido (reloj, jugadores, goles, cámara...) se
 * guarda con la misma estructura. Es la fuente de verdad: los intervalos de
 * juego, los minutos y el estado del partido se derivan de esta lista.
 *
 * Reglas:
 * - `timestamp` es tiempo real (epoch ms). Es lo que permitirá sincronizar con
 *   el vídeo: offset = event.timestamp - recording.startedAt.
 * - `matchTimeMs` y `period` son DERIVADOS del reloj del partido en ese
 *   instante. Se guardan por comodidad (listas, exportación, vídeo) pero se
 *   recalculan al regenerar las proyecciones (p. ej. tras deshacer).
 * - Los eventos no se borran: deshacer marca `voidedAt`.
 */

export const CLOCK_EVENT_TYPES = [
  'MATCH_STARTED',
  'MATCH_PAUSED',
  'MATCH_RESUMED',
  'HALFTIME_STARTED',
  'PERIOD_STARTED',
  'MATCH_ENDED',
] as const;

export const PLAYER_EVENT_TYPES = [
  'LINEUP_SET',
  'PLAYER_ENTERED',
  'PLAYER_LEFT',
  'SUBSTITUTION',
  'PLAYER_MOVED',
  'PLAYERS_SWAPPED',
  'GOALKEEPER_SET',
  'PLAYER_ADDED',
  'PLAYER_UNAVAILABLE',
] as const;

/** Reservados para la fase 2. No afectan al cálculo de minutos. */
export const GAME_EVENT_TYPES = ['GOAL', 'ASSIST', 'YELLOW_CARD', 'RED_CARD'] as const;

/** Generados por el módulo de cámara. No afectan al cálculo de minutos. */
export const CAMERA_EVENT_TYPES = [
  'CAMERA_RECORDING_STARTED',
  'CAMERA_RECORDING_PAUSED',
  'CAMERA_RECORDING_RESUMED',
  'CAMERA_RECORDING_STOPPED',
  'CAMERA_ZONE_CHANGED',
] as const;

export const SYSTEM_EVENT_TYPES = ['EVENT_UNDONE'] as const;

export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];
export type PlayerEventType = (typeof PLAYER_EVENT_TYPES)[number];
export type GameEventType = (typeof GAME_EVENT_TYPES)[number];
export type CameraEventType = (typeof CAMERA_EVENT_TYPES)[number];
export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

export type MatchEventType =
  | ClockEventType
  | PlayerEventType
  | GameEventType
  | CameraEventType
  | SystemEventType;

export const MATCH_EVENT_TYPES: readonly MatchEventType[] = [
  ...CLOCK_EVENT_TYPES,
  ...PLAYER_EVENT_TYPES,
  ...GAME_EVENT_TYPES,
  ...CAMERA_EVENT_TYPES,
  ...SYSTEM_EVENT_TYPES,
];

export type EventSource = 'user' | 'system' | 'camera';

/** Posición normalizada sobre el campo (0..1 en ambos ejes). */
export interface FieldPosition {
  x: number;
  y: number;
}

export interface LineupEntry {
  playerId: string;
  position: FieldPosition;
  goalkeeper?: boolean;
}

export type MatchEndReason = 'NORMAL' | 'SUSPENDED';
export type UnavailableReason = 'INJURY' | 'RED_CARD' | 'OTHER';

/**
 * Metadatos por tipo de evento. Los jugadores implicados van SIEMPRE en
 * `playerId` / `secondaryPlayerId` del evento, nunca aquí, para poder indexar
 * y filtrar "todas las intervenciones de un jugador".
 *
 * Convención: en SUBSTITUTION `playerId` = entra, `secondaryPlayerId` = sale.
 */
export interface EventMetadataMap {
  MATCH_STARTED: Record<string, never>;
  MATCH_PAUSED: Record<string, never>;
  MATCH_RESUMED: Record<string, never>;
  HALFTIME_STARTED: Record<string, never>;
  PERIOD_STARTED: Record<string, never>;
  MATCH_ENDED: { reason: MatchEndReason };

  LINEUP_SET: { field: LineupEntry[]; bench: string[] };
  PLAYER_ENTERED: { position: FieldPosition };
  PLAYER_LEFT: Record<string, never>;
  SUBSTITUTION: { position: FieldPosition };
  PLAYER_MOVED: { position: FieldPosition };
  PLAYERS_SWAPPED: Record<string, never>;
  GOALKEEPER_SET: Record<string, never>;
  PLAYER_ADDED: Record<string, never>;
  PLAYER_UNAVAILABLE: { unavailable: boolean; reason: UnavailableReason | null };

  GOAL: { ownGoal?: boolean };
  ASSIST: Record<string, never>;
  YELLOW_CARD: Record<string, never>;
  RED_CARD: Record<string, never>;

  CAMERA_RECORDING_STARTED: { recordingId: string; deviceType: string | null };
  CAMERA_RECORDING_PAUSED: { recordingId: string };
  CAMERA_RECORDING_RESUMED: { recordingId: string };
  CAMERA_RECORDING_STOPPED: { recordingId: string };
  CAMERA_ZONE_CHANGED: { zone: string; previousZone: string | null };

  EVENT_UNDONE: { targetEventId: string };
}

export interface MatchEvent<T extends MatchEventType = MatchEventType> {
  /** UUIDv7: ordenable por tiempo y seguro para sincronizar. */
  id: string;
  matchId: string;
  /** Orden estricto dentro del partido (1, 2, 3...). Desempata timestamps iguales. */
  seq: number;
  type: T;
  /** Epoch ms real en el que ocurrió (capturado en el gesto, no al guardar). */
  timestamp: number;
  /** Reloj de partido (ms) en ese instante. Derivado; se recalcula al regenerar. */
  matchTimeMs: number;
  /** Periodo (1, 2...). 0 antes del pitido inicial. Derivado. */
  period: number;
  playerId: string | null;
  secondaryPlayerId: string | null;
  metadata: EventMetadataMap[T];
  source: EventSource;
  /** Marcado por DESHACER. Un evento anulado se conserva pero no se aplica. */
  voidedAt: number | null;
}

/** Unión discriminada por `type` (permite `switch (event.type)` con tipado). */
export type AnyMatchEvent = { [K in MatchEventType]: MatchEvent<K> }[MatchEventType];

/**
 * Lo que produce un comando antes de persistirse. `id`, `seq`, `matchTimeMs`,
 * `period` y `voidedAt` los asigna el motor del partido.
 */
export interface NewMatchEvent<T extends MatchEventType = MatchEventType> {
  type: T;
  timestamp: number;
  playerId?: string | null;
  secondaryPlayerId?: string | null;
  metadata: EventMetadataMap[T];
  source?: EventSource;
}

export type AnyNewMatchEvent = { [K in MatchEventType]: NewMatchEvent<K> }[MatchEventType];

export function isClockEvent(type: MatchEventType): type is ClockEventType {
  return (CLOCK_EVENT_TYPES as readonly string[]).includes(type);
}

export function isPlayerEvent(type: MatchEventType): type is PlayerEventType {
  return (PLAYER_EVENT_TYPES as readonly string[]).includes(type);
}

export function isCameraEvent(type: MatchEventType): type is CameraEventType {
  return (CAMERA_EVENT_TYPES as readonly string[]).includes(type);
}

/** Eventos que modifican el estado del partido (reloj o jugadores). */
export function affectsMatchState(type: MatchEventType): boolean {
  return isClockEvent(type) || isPlayerEvent(type);
}

export function isMatchEventType(value: string): value is MatchEventType {
  return (MATCH_EVENT_TYPES as readonly string[]).includes(value);
}
