import type {
  EventMetadataMap,
  EventSource,
  FieldPosition,
  MatchEndReason,
  MatchEvent,
  MatchEventType,
  UnavailableReason,
} from '../events';
import type { MatchConfig, MatchRuleErrorCode, MatchState } from '../state';
import { MatchRuleError } from '../state';
import { reduceMatch } from '../reducer';

/**
 * Utilidades de test del dominio: eventos con `seq`/`id` automáticos y un
 * escenario F7 de 10 convocados. Los timestamps son epoch ms reales, como en
 * producción, para que cualquier error de unidades salte a la vista.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const T0 = 1_700_000_000_000;
export const MATCH_ID = 'match-f7-1';

/** Convocatoria F7: los 7 primeros son los titulares habituales. */
export const F7_SQUAD: readonly string[] = [
  'lucas',
  'hugo',
  'mateo',
  'leo',
  'daniel',
  'pablo',
  'alex',
  'marco',
  'adrian',
  'david',
];
export const STARTERS: readonly string[] = F7_SQUAD.slice(0, 7);
export const BENCH: readonly string[] = F7_SQUAD.slice(7);

export function f7Config(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    matchId: MATCH_ID,
    playersOnField: 7,
    periodsCount: 2,
    periodDurationMs: 25 * MINUTE,
    squad: [...F7_SQUAD],
    ...overrides,
  };
}

/** Posición válida distinta por índice, para distinguir jugadores en el campo. */
export const pos = (i = 0): FieldPosition => ({ x: Math.min(1, 0.05 + (i % 10) * 0.1), y: 0.5 });

interface EventOptions<T extends MatchEventType> {
  playerId?: string | null;
  secondaryPlayerId?: string | null;
  metadata?: EventMetadataMap[T];
  source?: EventSource;
  voidedAt?: number | null;
}

export class EventFactory {
  private seq = 0;

  constructor(readonly matchId: string = MATCH_ID) {}

  make<T extends MatchEventType>(type: T, timestamp: number, options: EventOptions<T> = {}): MatchEvent<T> {
    this.seq += 1;
    return {
      id: `evt-${String(this.seq).padStart(3, '0')}`,
      matchId: this.matchId,
      seq: this.seq,
      type,
      timestamp,
      // Derivados: los rellena deriveEventFields; aquí da igual su valor.
      matchTimeMs: 0,
      period: 0,
      playerId: options.playerId ?? null,
      secondaryPlayerId: options.secondaryPlayerId ?? null,
      metadata: options.metadata ?? ({} as EventMetadataMap[T]),
      source: options.source ?? 'user',
      voidedAt: options.voidedAt ?? null,
    };
  }

  lineup(ts: number, fieldIds: readonly string[], goalkeeperId?: string, bench: readonly string[] = []) {
    const field = fieldIds.map((playerId, i) =>
      playerId === goalkeeperId
        ? { playerId, position: pos(i), goalkeeper: true }
        : { playerId, position: pos(i) },
    );
    return this.make('LINEUP_SET', ts, { metadata: { field, bench: [...bench] } });
  }

  start(ts: number) {
    return this.make('MATCH_STARTED', ts);
  }
  pause(ts: number) {
    return this.make('MATCH_PAUSED', ts);
  }
  resume(ts: number) {
    return this.make('MATCH_RESUMED', ts);
  }
  halftime(ts: number) {
    return this.make('HALFTIME_STARTED', ts);
  }
  nextPeriod(ts: number) {
    return this.make('PERIOD_STARTED', ts);
  }
  end(ts: number, reason: MatchEndReason = 'NORMAL') {
    return this.make('MATCH_ENDED', ts, { metadata: { reason } });
  }

  enter(ts: number, playerId: string, position: FieldPosition = pos(6)) {
    return this.make('PLAYER_ENTERED', ts, { playerId, metadata: { position } });
  }
  leave(ts: number, playerId: string) {
    return this.make('PLAYER_LEFT', ts, { playerId });
  }
  /** `inId` entra por `outId` (convención del contrato: playerId = entra). */
  sub(ts: number, inId: string, outId: string, position: FieldPosition = pos(6)) {
    return this.make('SUBSTITUTION', ts, { playerId: inId, secondaryPlayerId: outId, metadata: { position } });
  }
  move(ts: number, playerId: string, position: FieldPosition) {
    return this.make('PLAYER_MOVED', ts, { playerId, metadata: { position } });
  }
  swap(ts: number, playerId: string, otherId: string) {
    return this.make('PLAYERS_SWAPPED', ts, { playerId, secondaryPlayerId: otherId });
  }
  goalkeeper(ts: number, playerId: string) {
    return this.make('GOALKEEPER_SET', ts, { playerId });
  }
  add(ts: number, playerId: string) {
    return this.make('PLAYER_ADDED', ts, { playerId });
  }
  unavailable(ts: number, playerId: string, reason: UnavailableReason | null) {
    return this.make('PLAYER_UNAVAILABLE', ts, { playerId, metadata: { unavailable: reason != null, reason } });
  }

  goal(ts: number, playerId: string) {
    return this.make('GOAL', ts, { playerId, metadata: {} });
  }
  cameraStarted(ts: number, recordingId = 'rec-1') {
    return this.make('CAMERA_RECORDING_STARTED', ts, {
      source: 'camera',
      metadata: { recordingId, deviceType: 'dummy' },
    });
  }
  undone(ts: number, targetEventId: string) {
    return this.make('EVENT_UNDONE', ts, { source: 'system', metadata: { targetEventId } });
  }
}

/** Copia anulada (DESHACER). */
export function voided<T extends MatchEventType>(event: MatchEvent<T>, at: number = event.timestamp): MatchEvent<T> {
  return { ...event, voidedAt: at };
}

export function run(events: readonly MatchEvent[], config: MatchConfig = f7Config()): MatchState {
  return reduceMatch(config, events);
}

/** Código de la MatchRuleError que lanza `fn`, o null si no lanza. Otros errores se propagan. */
export function ruleCode(fn: () => unknown): MatchRuleErrorCode | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof MatchRuleError) return error.code;
    throw error;
  }
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

/**
 * Partido F7 tipo: 7 titulares (Lucas portero), una pausa de 2 min en la 1ª
 * parte, 10 min de descanso y 2ª parte completa. Reloj: 10:00 en la pausa,
 * 25:00 al descanso, 50:00 al final.
 */
export function typicalMatch(ev: EventFactory = new EventFactory()) {
  const t = {
    lineup: T0,
    start: T0 + 5 * MINUTE,
    pause: T0 + 15 * MINUTE,
    resume: T0 + 17 * MINUTE,
    halftime: T0 + 32 * MINUTE,
    second: T0 + 42 * MINUTE,
    end: T0 + 67 * MINUTE,
  };
  const events = [
    ev.lineup(t.lineup, STARTERS, 'lucas'),
    ev.start(t.start),
    ev.pause(t.pause),
    ev.resume(t.resume),
    ev.halftime(t.halftime),
    ev.nextPeriod(t.second),
    ev.end(t.end),
  ];
  return { ev, t, events };
}
