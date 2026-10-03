import type { EventMetadataMap, MatchEvent, MatchEventType } from '../../core/events';

/**
 * Eventos de prueba para la persistencia. Aquí no importa que la secuencia
 * tenga sentido futbolístico (eso es cosa del dominio): importa que cada campo
 * sobreviva al viaje de ida y vuelta por el almacén.
 */

export const T0 = 1_700_000_000_000;
export const MATCH_ID = 'match-f7-1';

export function makeEvent(seq: number, overrides: Partial<MatchEvent> = {}): MatchEvent {
  const matchId = overrides.matchId ?? MATCH_ID;
  return {
    id: `${matchId}:evt-${seq}`,
    matchId,
    seq,
    type: 'PLAYER_ENTERED',
    timestamp: T0 + seq * 1000,
    matchTimeMs: seq * 1000,
    period: 1,
    playerId: 'hugo',
    secondaryPlayerId: null,
    metadata: { position: { x: 0.5, y: 0.5 } },
    source: 'user',
    voidedAt: null,
    ...overrides,
  };
}

/**
 * Metadata representativa de CADA tipo del catálogo. El tipo del objeto obliga
 * a completarlo cuando se añada un evento nuevo a `EventMetadataMap`.
 */
export const SAMPLE_METADATA: { [K in MatchEventType]: EventMetadataMap[K] } = {
  MATCH_STARTED: {},
  MATCH_PAUSED: {},
  MATCH_RESUMED: {},
  HALFTIME_STARTED: {},
  PERIOD_STARTED: {},
  MATCH_ENDED: { reason: 'SUSPENDED' },

  LINEUP_SET: {
    field: [
      { playerId: 'lucas', position: { x: 0.1, y: 0.5 }, goalkeeper: true },
      { playerId: 'iñaki', position: { x: 0.35, y: 0.25 } },
    ],
    bench: ['josé maría', 'ángel'],
  },
  PLAYER_ENTERED: { position: { x: 0.6, y: 0.4 } },
  PLAYER_LEFT: {},
  SUBSTITUTION: { position: { x: 0.7, y: 0.8 } },
  PLAYER_MOVED: { position: { x: 0.2, y: 0.9 } },
  PLAYERS_SWAPPED: {},
  GOALKEEPER_SET: {},
  PLAYER_ADDED: {},
  PLAYER_UNAVAILABLE: { unavailable: true, reason: 'INJURY' },

  GOAL: { ownGoal: true },
  ASSIST: {},
  YELLOW_CARD: {},
  RED_CARD: {},

  CAMERA_RECORDING_STARTED: { recordingId: 'rec-1', deviceType: 'dji_rsc2' },
  CAMERA_RECORDING_PAUSED: { recordingId: 'rec-1' },
  CAMERA_RECORDING_RESUMED: { recordingId: 'rec-1' },
  CAMERA_RECORDING_STOPPED: { recordingId: 'rec-1' },
  CAMERA_ZONE_CHANGED: { zone: 'LEFT', previousZone: null },

  EVENT_UNDONE: { targetEventId: 'match-f7-1:evt-3' },
};
