import type {
  AnyMatchEvent,
  ClockEventType,
  FieldPosition,
  LineupEntry,
  MatchEvent,
} from './events';
import { affectsMatchState } from './events';
import type {
  ClockSegment,
  MatchConfig,
  MatchPlayerState,
  MatchState,
  MatchStatus,
  PlayerInterval,
} from './state';
import { MatchRuleError } from './state';

/**
 * MatchEngine, parte pura: eventos → estado.
 *
 * - `applyEvent` nunca muta: devuelve un estado nuevo (o lanza MatchRuleError).
 * - La validación está separada (`validateEvent`) para que la fachada pueda
 *   rechazar un comando ANTES de persistirlo: así nunca se guarda un evento
 *   que luego no se podría aplicar al regenerar.
 * - No se exige que los timestamps sean monótonos: el reloj del sistema puede
 *   saltar y los tramos son hechos, no se corrigen. La aritmética de `time.ts`
 *   ya se protege con `Math.max(0, …)`.
 */

const PRE_MATCH: readonly MatchStatus[] = ['DRAFT', 'READY'];
const IN_PLAY: readonly MatchStatus[] = ['RUNNING', 'PAUSED', 'HALFTIME'];

/** Entre el pitido inicial y el final: los movimientos crean intervalos y cuentan entradas. */
const hasStarted = (status: MatchStatus): boolean => IN_PLAY.includes(status);

export function createInitialState(config: MatchConfig): MatchState {
  const players: Record<string, MatchPlayerState> = {};
  for (const playerId of config.squad) players[playerId] = benchPlayer(playerId, false);
  return {
    config,
    status: 'DRAFT',
    currentPeriod: 0,
    endReason: null,
    players,
    clockSegments: [],
    intervals: [],
    lastSeq: 0,
  };
}

export function applyEvent(state: MatchState, event: MatchEvent): MatchState {
  validateEvent(state, event);
  const lastSeq = Math.max(state.lastSeq, event.seq);
  // Anulados y eventos que no afectan al estado (goles, cámara, sistema) solo
  // avanzan `lastSeq`: la timeline los conserva, el estado los ignora.
  if (event.voidedAt != null || !affectsMatchState(event.type)) return { ...state, lastSeq };
  return { ...transition(state, event as AnyMatchEvent), lastSeq };
}

/** Reconstruye el estado desde cero. El orden lo da `seq`, no el array. */
export function reduceMatch(config: MatchConfig, events: readonly MatchEvent[]): MatchState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let state = createInitialState(config);
  for (const event of ordered) state = applyEvent(state, event);
  return state;
}

// ───────────────────────── Validación ─────────────────────────

export function validateEvent(state: MatchState, event: MatchEvent): void {
  if (event.matchId !== state.config.matchId) {
    throw new MatchRuleError('INVALID_EVENT', `El evento ${event.id} pertenece a otro partido`);
  }
  // Un evento anulado no se aplica, así que no puede ser inválido; y los que no
  // tocan el estado se admiten en cualquier momento (también en FINISHED).
  if (event.voidedAt != null || !affectsMatchState(event.type)) return;
  if (state.status === 'FINISHED') {
    throw new MatchRuleError('INVALID_STATUS', `Partido finalizado: no se admite ${event.type}`);
  }

  const e = event as AnyMatchEvent;
  switch (e.type) {
    case 'MATCH_STARTED':
      requireStatus(state, e.type, ['READY']);
      if (fieldCount(state) === 0) {
        throw new MatchRuleError('INVALID_EVENT', 'No se puede iniciar sin jugadores en el campo');
      }
      return;
    case 'MATCH_PAUSED':
      return requireStatus(state, e.type, ['RUNNING']);
    case 'MATCH_RESUMED':
      return requireStatus(state, e.type, ['PAUSED']);
    case 'HALFTIME_STARTED':
      requireStatus(state, e.type, ['RUNNING', 'PAUSED']);
      if (state.currentPeriod >= state.config.periodsCount) {
        throw new MatchRuleError(
          'NO_MORE_PERIODS',
          `Ya se juega el último periodo (${state.currentPeriod}/${state.config.periodsCount})`,
        );
      }
      return;
    case 'PERIOD_STARTED':
      return requireStatus(state, e.type, ['HALFTIME']);
    case 'MATCH_ENDED':
      return requireStatus(state, e.type, IN_PLAY);

    case 'LINEUP_SET':
      requireStatus(state, e.type, PRE_MATCH);
      return validateLineup(state, e.metadata.field, e.metadata.bench);
    case 'PLAYER_ENTERED':
      requireOnBench(state, e.playerId);
      if (fieldCount(state) >= state.config.playersOnField) {
        throw new MatchRuleError('FIELD_FULL', `Ya hay ${state.config.playersOnField} jugadores en el campo`);
      }
      return requirePosition(e.metadata.position);
    case 'PLAYER_LEFT':
      requireOnField(state, e.playerId);
      return;
    case 'SUBSTITUTION':
      // 1 por 1: no se comprueba FIELD_FULL porque el campo no crece.
      requireOnBench(state, e.playerId);
      requireOnField(state, e.secondaryPlayerId);
      return requirePosition(e.metadata.position);
    case 'PLAYER_MOVED':
      requireOnField(state, e.playerId);
      return requirePosition(e.metadata.position);
    case 'PLAYERS_SWAPPED':
      requireOnField(state, e.playerId);
      requireOnField(state, e.secondaryPlayerId);
      if (e.playerId === e.secondaryPlayerId) {
        throw new MatchRuleError('INVALID_EVENT', 'Un jugador no puede intercambiarse consigo mismo');
      }
      return;
    case 'GOALKEEPER_SET':
    case 'PLAYER_UNAVAILABLE':
      requirePlayer(state, e.playerId);
      return;
    case 'PLAYER_ADDED':
      if (e.playerId == null || state.players[e.playerId]) {
        throw new MatchRuleError('INVALID_EVENT', `No se puede añadir al jugador ${e.playerId ?? '(ninguno)'}`);
      }
      return;
    default:
      return;
  }
}

function requireStatus(state: MatchState, type: string, allowed: readonly MatchStatus[]): void {
  if (!allowed.includes(state.status)) {
    throw new MatchRuleError('INVALID_STATUS', `${type} no se admite en estado ${state.status}`);
  }
}

function requirePlayer(state: MatchState, playerId: string | null): MatchPlayerState {
  const player = playerId == null ? undefined : state.players[playerId];
  if (!player) throw new MatchRuleError('UNKNOWN_PLAYER', `Jugador desconocido: ${playerId ?? '(ninguno)'}`);
  return player;
}

function requireOnBench(state: MatchState, playerId: string | null): MatchPlayerState {
  const player = requirePlayer(state, playerId);
  if (player.location !== 'BENCH') {
    throw new MatchRuleError('PLAYER_ALREADY_ON_FIELD', `${player.playerId} ya está en el campo`);
  }
  return player;
}

function requireOnField(state: MatchState, playerId: string | null): MatchPlayerState {
  const player = requirePlayer(state, playerId);
  if (player.location !== 'FIELD') {
    throw new MatchRuleError('PLAYER_NOT_ON_FIELD', `${player.playerId} no está en el campo`);
  }
  return player;
}

function isValidPosition(position: unknown): position is FieldPosition {
  if (typeof position !== 'object' || position === null) return false;
  const { x, y } = position as Record<string, unknown>;
  return [x, y].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
}

function requirePosition(position: unknown): void {
  if (!isValidPosition(position)) {
    throw new MatchRuleError('INVALID_POSITION', 'La posición debe estar entre 0 y 1 en ambos ejes');
  }
}

function validateLineup(state: MatchState, field: readonly LineupEntry[], bench: readonly string[]): void {
  if (field.length > state.config.playersOnField) {
    throw new MatchRuleError('FIELD_FULL', `La alineación tiene ${field.length} jugadores y el máximo es ${state.config.playersOnField}`);
  }
  const seen = new Set<string>();
  for (const entry of field) {
    requirePlayer(state, entry.playerId);
    if (seen.has(entry.playerId)) {
      throw new MatchRuleError('INVALID_EVENT', `${entry.playerId} aparece dos veces en la alineación`);
    }
    seen.add(entry.playerId);
    requirePosition(entry.position);
  }
  for (const playerId of bench) requirePlayer(state, playerId);
}

// ───────────────────────── Transiciones ─────────────────────────

/** Tras `validateEvent` el id existe; esto solo estrecha el tipo. */
function idOf(playerId: string | null): string {
  if (playerId == null) throw new MatchRuleError('UNKNOWN_PLAYER', 'Falta el jugador del evento');
  return playerId;
}

function transition(state: MatchState, e: AnyMatchEvent): MatchState {
  switch (e.type) {
    case 'MATCH_STARTED': {
      // "Titular" es quien está en el campo en el pitido, no la planificación.
      const starters = fieldPlayers(state);
      return {
        ...withClock(state, e),
        status: 'RUNNING',
        players: mapPlayers(state.players, (p) => (p.location === 'FIELD' ? { ...p, wasStarter: true } : p)),
        intervals: [...state.intervals, ...starters.map((p) => openInterval(p.playerId, e))],
      };
    }
    case 'MATCH_PAUSED':
      return { ...withClock(state, e), status: 'PAUSED' };
    case 'MATCH_RESUMED':
    case 'PERIOD_STARTED':
      return { ...withClock(state, e), status: 'RUNNING' };
    case 'HALFTIME_STARTED':
      return { ...withClock(state, e), status: 'HALFTIME' };
    case 'MATCH_ENDED':
      return {
        ...withClock(state, e),
        status: 'FINISHED',
        endReason: e.metadata.reason,
        intervals: state.intervals.map((i) => (i.endedAt == null ? closeInterval(i, e) : i)),
      };

    case 'LINEUP_SET':
      return applyLineup(state, e.metadata.field);
    case 'PLAYER_ENTERED':
      return settle(moveToField(state, idOf(e.playerId), e.metadata.position, e));
    case 'PLAYER_LEFT':
      return settle(moveToBench(state, idOf(e.playerId), e));
    case 'SUBSTITUTION': {
      const inId = idOf(e.playerId);
      const outId = idOf(e.secondaryPlayerId);
      const outWasGoalkeeper = state.players[outId]?.isGoalkeeper === true;
      // Atómico y con el MISMO timestamp: el que sale cierra y el que entra abre en `e.timestamp`.
      let next = moveToField(moveToBench(state, outId, e), inId, e.metadata.position, e);
      if (outWasGoalkeeper) {
        next = {
          ...next,
          players: mapPlayers(next.players, (p) => ({ ...p, isGoalkeeper: p.playerId === inId })),
        };
      }
      return settle(next);
    }
    case 'PLAYER_MOVED':
      return { ...state, players: patchPlayer(state.players, idOf(e.playerId), { position: copyPosition(e.metadata.position) }) };
    case 'PLAYERS_SWAPPED': {
      const a = requirePlayer(state, e.playerId);
      const b = requirePlayer(state, e.secondaryPlayerId);
      const players = patchPlayer(patchPlayer(state.players, a.playerId, { position: b.position }), b.playerId, { position: a.position });
      return { ...state, players };
    }
    case 'GOALKEEPER_SET': {
      const goalkeeperId = idOf(e.playerId);
      return { ...state, players: mapPlayers(state.players, (p) => ({ ...p, isGoalkeeper: p.playerId === goalkeeperId })) };
    }
    case 'PLAYER_ADDED': {
      const playerId = idOf(e.playerId);
      return { ...state, players: { ...state.players, [playerId]: benchPlayer(playerId, hasStarted(state.status)) } };
    }
    case 'PLAYER_UNAVAILABLE': {
      const unavailable = e.metadata.unavailable ? (e.metadata.reason ?? 'OTHER') : null;
      return { ...state, players: patchPlayer(state.players, idOf(e.playerId), { unavailable }) };
    }
    default:
      return state;
  }
}

/**
 * Efecto de un evento de reloj sobre los segmentos. Es público porque
 * `derive.ts` lo reutiliza: los campos derivados de la timeline y el estado
 * del partido deben salir de la MISMA regla o acabarían discrepando.
 */
export function applyClockEvent(
  segments: readonly ClockSegment[],
  currentPeriod: number,
  type: ClockEventType,
  timestamp: number,
): { segments: ClockSegment[]; currentPeriod: number } {
  switch (type) {
    case 'MATCH_STARTED':
      return { segments: [...segments, openSegment(1, timestamp)], currentPeriod: 1 };
    case 'MATCH_RESUMED':
      return { segments: [...segments, openSegment(currentPeriod, timestamp)], currentPeriod };
    case 'PERIOD_STARTED':
      return { segments: [...segments, openSegment(currentPeriod + 1, timestamp)], currentPeriod: currentPeriod + 1 };
    case 'MATCH_PAUSED':
    case 'HALFTIME_STARTED':
    case 'MATCH_ENDED':
      return {
        segments: segments.map((s) => (s.endedAt == null ? { ...s, endedAt: timestamp } : s)),
        currentPeriod,
      };
  }
}

function withClock(state: MatchState, e: MatchEvent<ClockEventType>): MatchState {
  const { segments, currentPeriod } = applyClockEvent(state.clockSegments, state.currentPeriod, e.type, e.timestamp);
  return { ...state, clockSegments: segments, currentPeriod };
}

const openSegment = (period: number, startedAt: number): ClockSegment => ({ period, startedAt, endedAt: null });

const openInterval = (playerId: string, e: MatchEvent): PlayerInterval => ({
  playerId,
  startedAt: e.timestamp,
  endedAt: null,
  startEventId: e.id,
  endEventId: null,
});

const closeInterval = (interval: PlayerInterval, e: MatchEvent): PlayerInterval => ({
  ...interval,
  endedAt: e.timestamp,
  endEventId: e.id,
});

function benchPlayer(playerId: string, addedLate: boolean): MatchPlayerState {
  return {
    playerId,
    location: 'BENCH',
    position: null,
    isGoalkeeper: false,
    unavailable: null,
    wasStarter: false,
    entries: 0,
    addedLate,
  };
}

/** Copia defensiva: la posición del estado no debe compartir objeto con la del evento. */
const copyPosition = (p: FieldPosition): FieldPosition => ({ x: p.x, y: p.y });

const fieldPlayers = (state: MatchState): MatchPlayerState[] =>
  Object.values(state.players).filter((p) => p.location === 'FIELD');

const fieldCount = (state: MatchState): number => fieldPlayers(state).length;

function mapPlayers(
  players: Record<string, MatchPlayerState>,
  fn: (p: MatchPlayerState) => MatchPlayerState,
): Record<string, MatchPlayerState> {
  const out: Record<string, MatchPlayerState> = {};
  for (const [id, p] of Object.entries(players)) out[id] = fn(p);
  return out;
}

function patchPlayer(
  players: Record<string, MatchPlayerState>,
  playerId: string,
  patch: Partial<MatchPlayerState>,
): Record<string, MatchPlayerState> {
  const current = players[playerId];
  return current ? { ...players, [playerId]: { ...current, ...patch } } : players;
}

/** Antes del pitido los movimientos solo editan la alineación: ni intervalos ni entradas. */
function moveToField(state: MatchState, playerId: string, position: FieldPosition, e: MatchEvent): MatchState {
  const started = hasStarted(state.status);
  const player = requirePlayer(state, playerId);
  return {
    ...state,
    players: patchPlayer(state.players, playerId, {
      location: 'FIELD',
      position: copyPosition(position),
      entries: player.entries + (started ? 1 : 0),
    }),
    intervals: started ? [...state.intervals, openInterval(playerId, e)] : state.intervals,
  };
}

function moveToBench(state: MatchState, playerId: string, e: MatchEvent): MatchState {
  return {
    ...state,
    players: patchPlayer(state.players, playerId, { location: 'BENCH', position: null }),
    intervals: state.intervals.map((i) => (i.playerId === playerId && i.endedAt == null ? closeInterval(i, e) : i)),
  };
}

function applyLineup(state: MatchState, field: readonly LineupEntry[]): MatchState {
  const entries = new Map(field.map((entry) => [entry.playerId, entry]));
  // Si la alineación nombra portero, manda ella; si no, se respeta el que hubiera.
  const declaresGoalkeeper = field.some((entry) => entry.goalkeeper === true);
  const players = mapPlayers(state.players, (p) => {
    const entry = entries.get(p.playerId);
    const isGoalkeeper = declaresGoalkeeper ? entry?.goalkeeper === true : p.isGoalkeeper;
    return entry
      ? { ...p, location: 'FIELD', position: copyPosition(entry.position), isGoalkeeper }
      : { ...p, location: 'BENCH', position: null, isGoalkeeper };
  });
  return { ...state, status: 'READY', players };
}

/** En DRAFT, el primer jugador que pisa el campo deja el partido listo para iniciar. */
function settle(state: MatchState): MatchState {
  return state.status === 'DRAFT' && fieldCount(state) > 0 ? { ...state, status: 'READY' } : state;
}
