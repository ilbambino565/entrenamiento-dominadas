import type { ClockEventType, MatchEvent } from '../events';
import type { MatchStatus } from '../state';
import { applyEvent, createInitialState, reduceMatch, validateEvent } from '../reducer';
import { checkInvariants } from '../invariants';
import { formatClock, matchClockMs, playerPlayedMs } from '../time';
import {
  BENCH,
  EventFactory,
  F7_SQUAD,
  MINUTE,
  SECOND,
  STARTERS,
  T0,
  deepFreeze,
  f7Config,
  pos,
  ruleCode,
  run,
  typicalMatch,
  voided,
} from './helpers';

const player = (events: readonly MatchEvent[], id: string) => {
  const p = run(events).players[id];
  if (!p) throw new Error(`jugador ${id} no existe`);
  return p;
};

const openIntervals = (events: readonly MatchEvent[]) => run(events).intervals.filter((i) => i.endedAt == null);

/** Un estado por cada status, construidos con un mismo factory (seq coherentes). */
function statesByStatus() {
  const ev = new EventFactory();
  const lineup = ev.lineup(T0, STARTERS, 'lucas');
  const start = ev.start(T0 + MINUTE);
  const pause = ev.pause(T0 + 2 * MINUTE);
  const halftime = ev.halftime(T0 + 3 * MINUTE);
  const end = ev.end(T0 + 4 * MINUTE);
  const states: Record<MatchStatus, ReturnType<typeof run>> = {
    DRAFT: run([]),
    READY: run([lineup]),
    RUNNING: run([lineup, start]),
    PAUSED: run([lineup, start, pause]),
    HALFTIME: run([lineup, start, halftime]),
    FINISHED: run([lineup, start, end]),
  };
  return { ev, states };
}

const CLOCK_TYPES: readonly ClockEventType[] = [
  'MATCH_STARTED',
  'MATCH_PAUSED',
  'MATCH_RESUMED',
  'HALFTIME_STARTED',
  'PERIOD_STARTED',
  'MATCH_ENDED',
];

const VALID_TRANSITIONS: ReadonlyArray<[MatchStatus, ClockEventType, MatchStatus]> = [
  ['READY', 'MATCH_STARTED', 'RUNNING'],
  ['RUNNING', 'MATCH_PAUSED', 'PAUSED'],
  ['PAUSED', 'MATCH_RESUMED', 'RUNNING'],
  ['RUNNING', 'HALFTIME_STARTED', 'HALFTIME'],
  ['PAUSED', 'HALFTIME_STARTED', 'HALFTIME'],
  ['HALFTIME', 'PERIOD_STARTED', 'RUNNING'],
  ['RUNNING', 'MATCH_ENDED', 'FINISHED'],
  ['PAUSED', 'MATCH_ENDED', 'FINISHED'],
  ['HALFTIME', 'MATCH_ENDED', 'FINISHED'],
];

const INVALID_TRANSITIONS: Array<[MatchStatus, ClockEventType]> = [];
for (const status of ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'HALFTIME', 'FINISHED'] as const) {
  for (const type of CLOCK_TYPES) {
    if (!VALID_TRANSITIONS.some(([from, t]) => from === status && t === type)) INVALID_TRANSITIONS.push([status, type]);
  }
}

const clockEvent = (ev: EventFactory, type: ClockEventType, ts: number) =>
  ev.make(type, ts, type === 'MATCH_ENDED' ? { metadata: { reason: 'NORMAL' } } : {});

describe('createInitialState', () => {
  it('empieza en DRAFT con toda la convocatoria en el banquillo', () => {
    const state = createInitialState(f7Config());
    expect(state.status).toBe('DRAFT');
    expect(state.currentPeriod).toBe(0);
    expect(state.lastSeq).toBe(0);
    expect(state.endReason).toBeNull();
    expect(state.clockSegments).toEqual([]);
    expect(state.intervals).toEqual([]);
    expect(Object.keys(state.players)).toEqual([...F7_SQUAD]);
    for (const p of Object.values(state.players)) {
      expect(p).toMatchObject({ location: 'BENCH', position: null, wasStarter: false, entries: 0, addedLate: false });
    }
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('transiciones de estado', () => {
  it.each(VALID_TRANSITIONS)('%s + %s → %s', (from, type, to) => {
    const { ev, states } = statesByStatus();
    const next = applyEvent(states[from], clockEvent(ev, type, T0 + 10 * MINUTE));
    expect(next.status).toBe(to);
    expect(checkInvariants(next)).toEqual([]);
  });

  it.each(INVALID_TRANSITIONS)('%s + %s → INVALID_STATUS', (from, type) => {
    const { ev, states } = statesByStatus();
    expect(ruleCode(() => applyEvent(states[from], clockEvent(ev, type, T0 + 10 * MINUTE)))).toBe('INVALID_STATUS');
  });

  it('LINEUP_SET solo antes del pitido y se puede repetir', () => {
    const { ev, states } = statesByStatus();
    const again = applyEvent(states.READY, ev.lineup(T0 + 1, BENCH.concat(STARTERS.slice(0, 4))));
    expect(again.status).toBe('READY');
    const onField = Object.values(again.players).filter((p) => p.location === 'FIELD').map((p) => p.playerId);
    expect([...onField].sort()).toEqual([...BENCH, ...STARTERS.slice(0, 4)].sort());
    for (const status of ['RUNNING', 'PAUSED', 'HALFTIME', 'FINISHED'] as const) {
      expect(ruleCode(() => applyEvent(states[status], ev.lineup(T0 + 1, STARTERS)))).toBe('INVALID_STATUS');
    }
  });

  it('MATCH_STARTED exige al menos un jugador en el campo', () => {
    const ev = new EventFactory();
    const emptyLineup = run([ev.lineup(T0, [])]);
    expect(emptyLineup.status).toBe('READY');
    expect(ruleCode(() => applyEvent(emptyLineup, ev.start(T0 + 1)))).toBe('INVALID_EVENT');
  });

  it('HALFTIME_STARTED en el último periodo → NO_MORE_PERIODS', () => {
    const ev = new EventFactory();
    const secondHalf = run([ev.lineup(T0, STARTERS), ev.start(T0), ev.halftime(T0 + 25 * MINUTE), ev.nextPeriod(T0 + 35 * MINUTE)]);
    expect(secondHalf.currentPeriod).toBe(2);
    expect(ruleCode(() => applyEvent(secondHalf, ev.halftime(T0 + 60 * MINUTE)))).toBe('NO_MORE_PERIODS');
    expect(ruleCode(() => applyEvent(secondHalf, ev.end(T0 + 60 * MINUTE)))).toBeNull();
  });

  it('con 4 cuartos se admiten 3 descansos', () => {
    const ev = new EventFactory();
    const events: MatchEvent[] = [ev.lineup(T0, STARTERS), ev.start(T0)];
    for (let q = 1; q < 4; q++) {
      events.push(ev.halftime(T0 + q * 20 * MINUTE), ev.nextPeriod(T0 + q * 20 * MINUTE + 5 * MINUTE));
    }
    const state = reduceMatch(f7Config({ periodsCount: 4 }), events);
    expect(state.currentPeriod).toBe(4);
    expect(state.clockSegments.map((s) => s.period)).toEqual([1, 2, 3, 4]);
    expect(ruleCode(() => applyEvent(state, ev.halftime(T0 + 90 * MINUTE)))).toBe('NO_MORE_PERIODS');
  });

  it('en FINISHED no se admite ningún evento de estado', () => {
    const { ev, states } = statesByStatus();
    const attempts = [
      ev.enter(T0, 'marco'),
      ev.leave(T0, 'lucas'),
      ev.sub(T0, 'marco', 'lucas'),
      ev.move(T0, 'lucas', pos(3)),
      ev.swap(T0, 'lucas', 'hugo'),
      ev.goalkeeper(T0, 'hugo'),
      ev.add(T0, 'nuevo'),
      ev.unavailable(T0, 'lucas', 'INJURY'),
    ];
    for (const attempt of attempts) expect(ruleCode(() => applyEvent(states.FINISHED, attempt))).toBe('INVALID_STATUS');
  });
});

describe('alineación antes del pitido', () => {
  it('PLAYER_ENTERED en DRAFT deja el partido READY sin abrir intervalos ni contar entradas', () => {
    const ev = new EventFactory();
    const state = run([ev.enter(T0, 'lucas', pos(0))]);
    expect(state.status).toBe('READY');
    expect(state.players.lucas).toMatchObject({ location: 'FIELD', position: pos(0), entries: 0 });
    expect(state.intervals).toEqual([]);
  });

  it('PLAYER_LEFT y SUBSTITUTION antes de iniciar solo editan la alineación', () => {
    const ev = new EventFactory();
    const events = [ev.lineup(T0, STARTERS), ev.leave(T0 + 1, 'alex'), ev.sub(T0 + 2, 'marco', 'lucas', pos(0))];
    const state = run(events);
    expect(state.status).toBe('READY');
    expect(state.intervals).toEqual([]);
    expect(state.players.alex?.location).toBe('BENCH');
    expect(state.players.lucas?.location).toBe('BENCH');
    expect(state.players.marco).toMatchObject({ location: 'FIELD', entries: 0 });
  });

  it('titular = en el campo en el pitido: el planificado que sale antes de INICIAR ni es titular ni suma', () => {
    const ev = new EventFactory();
    const lineup = ev.lineup(T0, STARTERS, 'lucas');
    const plannedOut = ev.sub(T0 + 5 * MINUTE, 'marco', 'lucas', pos(0));
    const start = ev.start(T0 + 10 * MINUTE);
    const events = [lineup, plannedOut, start];
    const state = run(events);
    const now = T0 + 30 * MINUTE;
    expect(state.players.lucas?.wasStarter).toBe(false);
    expect(playerPlayedMs(state, 'lucas', now)).toBe(0);
    expect(state.players.marco?.wasStarter).toBe(true);
    expect(playerPlayedMs(state, 'marco', now)).toBe(20 * MINUTE);
    expect(state.intervals).toHaveLength(7);
    for (const interval of state.intervals) {
      expect(interval).toMatchObject({ startedAt: start.timestamp, startEventId: start.id, endedAt: null, endEventId: null });
    }
    // El portero pasa al que entra por él, también antes del pitido.
    expect(state.players.marco?.isGoalkeeper).toBe(true);
    expect(state.players.lucas?.isGoalkeeper).toBe(false);
  });

  it('LINEUP_SET rechaza más jugadores que plazas, desconocidos, repetidos y posiciones fuera de 0..1', () => {
    const ev = new EventFactory();
    const draft = run([]);
    expect(ruleCode(() => applyEvent(draft, ev.lineup(T0, F7_SQUAD.slice(0, 8))))).toBe('FIELD_FULL');
    expect(ruleCode(() => applyEvent(draft, ev.lineup(T0, ['lucas', 'fantasma'])))).toBe('UNKNOWN_PLAYER');
    expect(ruleCode(() => applyEvent(draft, ev.lineup(T0, ['lucas', 'lucas'])))).toBe('INVALID_EVENT');
    expect(ruleCode(() => applyEvent(draft, ev.lineup(T0, [], undefined, ['fantasma'])))).toBe('UNKNOWN_PLAYER');
    const badPosition = ev.make('LINEUP_SET', T0, {
      metadata: { field: [{ playerId: 'lucas', position: { x: 1.5, y: 0 } }], bench: [] },
    });
    expect(ruleCode(() => applyEvent(draft, badPosition))).toBe('INVALID_POSITION');
  });
});

describe('reloj', () => {
  it('MATCH_STARTED abre el periodo 1 y un intervalo por titular', () => {
    const ev = new EventFactory();
    const lineup = ev.lineup(T0, STARTERS);
    const start = ev.start(T0 + MINUTE);
    const state = run([lineup, start]);
    expect(state).toMatchObject({ status: 'RUNNING', currentPeriod: 1 });
    expect(state.clockSegments).toEqual([{ period: 1, startedAt: start.timestamp, endedAt: null }]);
    expect(state.intervals.map((i) => i.playerId)).toEqual([...STARTERS]);
    expect(STARTERS.every((id) => state.players[id]?.wasStarter)).toBe(true);
    expect(BENCH.every((id) => state.players[id]?.wasStarter === false)).toBe(true);
  });

  it('la pausa cierra el segmento y no toca los intervalos; reanudar abre otro del mismo periodo', () => {
    const ev = new EventFactory();
    const kickoff = [ev.lineup(T0, STARTERS), ev.start(T0)];
    const pause = ev.pause(T0 + 10 * MINUTE);
    const resume = ev.resume(T0 + 12 * MINUTE);
    const paused = run([...kickoff, pause]);
    expect(paused.status).toBe('PAUSED');
    expect(paused.clockSegments).toEqual([{ period: 1, startedAt: T0, endedAt: pause.timestamp }]);
    expect(openIntervals([...kickoff, pause])).toHaveLength(7);

    const resumed = applyEvent(paused, resume);
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.clockSegments[1]).toEqual({ period: 1, startedAt: resume.timestamp, endedAt: null });
    expect(matchClockMs(resumed.clockSegments, T0 + 20 * MINUTE)).toBe(18 * MINUTE);
    expect(playerPlayedMs(resumed, 'lucas', T0 + 20 * MINUTE)).toBe(18 * MINUTE);
  });

  it('el descanso cierra el segmento sin cambiar de periodo; PERIOD_STARTED abre el siguiente', () => {
    const { t, events } = typicalMatch();
    const halftime = run(events.slice(0, 5));
    expect(halftime).toMatchObject({ status: 'HALFTIME', currentPeriod: 1 });
    expect(halftime.clockSegments.at(-1)).toEqual({ period: 1, startedAt: t.resume, endedAt: t.halftime });
    expect(halftime.intervals.every((i) => i.endedAt == null)).toBe(true);

    const second = run(events.slice(0, 6));
    expect(second).toMatchObject({ status: 'RUNNING', currentPeriod: 2 });
    expect(second.clockSegments.at(-1)).toEqual({ period: 2, startedAt: t.second, endedAt: null });
  });

  it('MATCH_ENDED cierra el segmento y TODOS los intervalos abiertos con su endEventId', () => {
    const ev = new EventFactory();
    const played = [ev.lineup(T0, STARTERS), ev.start(T0), ev.sub(T0 + 10 * MINUTE, 'marco', 'lucas')];
    const end = ev.end(T0 + 50 * MINUTE, 'SUSPENDED');
    const state = run([...played, end]);
    expect(state).toMatchObject({ status: 'FINISHED', endReason: 'SUSPENDED' });
    expect(state.clockSegments.every((s) => s.endedAt != null)).toBe(true);
    expect(state.intervals.every((i) => i.endedAt != null)).toBe(true);
    const closedByEnd = state.intervals.filter((i) => i.endEventId === end.id);
    expect(closedByEnd).toHaveLength(7);
    expect(closedByEnd.every((i) => i.endedAt === end.timestamp)).toBe(true);
    expect(state.intervals.find((i) => i.playerId === 'lucas')?.endedAt).toBe(T0 + 10 * MINUTE);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('MATCH_ENDED desde el descanso también cierra los intervalos abiertos', () => {
    const { ev, events } = typicalMatch();
    const state = reduceMatch(f7Config(), [...events.slice(0, 5), ev.end(T0 + 40 * MINUTE, 'SUSPENDED')]);
    expect(state.status).toBe('FINISHED');
    expect(state.intervals.every((i) => i.endedAt === T0 + 40 * MINUTE)).toBe(true);
  });

  it('no exige timestamps monótonos y nunca produce tiempos negativos', () => {
    const ev = new EventFactory();
    const state = run([ev.lineup(T0, STARTERS), ev.start(T0 + 10 * MINUTE), ev.leave(T0 + 5 * MINUTE, 'lucas')]);
    expect(state.players.lucas?.location).toBe('BENCH');
    expect(playerPlayedMs(state, 'lucas', T0 + 20 * MINUTE)).toBe(0);
    expect(playerPlayedMs(state, 'hugo', T0 + 20 * MINUTE)).toBe(10 * MINUTE);
  });
});

describe('entradas, salidas y sustituciones', () => {
  const started = (ev: EventFactory) => [ev.lineup(T0, STARTERS, 'lucas'), ev.start(T0)];

  it('SUBSTITUTION es atómica: cierra y abre con el mismo timestamp y cuenta la entrada', () => {
    const ev = new EventFactory();
    const kickoff = started(ev);
    const sub = ev.sub(T0 + 10 * MINUTE, 'marco', 'hugo', pos(1));
    const state = run([...kickoff, sub]);
    const hugo = state.intervals.find((i) => i.playerId === 'hugo');
    const marco = state.intervals.find((i) => i.playerId === 'marco');
    expect(hugo).toMatchObject({ endedAt: sub.timestamp, endEventId: sub.id });
    expect(marco).toMatchObject({ startedAt: sub.timestamp, startEventId: sub.id, endedAt: null });
    expect(state.players.hugo).toMatchObject({ location: 'BENCH', position: null, entries: 0 });
    expect(state.players.marco).toMatchObject({ location: 'FIELD', position: pos(1), entries: 1, wasStarter: false });
    expect(state.status).toBe('RUNNING');
    const now = T0 + 25 * MINUTE;
    expect(playerPlayedMs(state, 'hugo', now)).toBe(10 * MINUTE);
    expect(playerPlayedMs(state, 'marco', now)).toBe(15 * MINUTE);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('el que entra por el portero hereda el rol', () => {
    const ev = new EventFactory();
    const state = run([...started(ev), ev.sub(T0 + 10 * MINUTE, 'marco', 'lucas')]);
    expect(state.players.marco?.isGoalkeeper).toBe(true);
    expect(state.players.lucas?.isGoalkeeper).toBe(false);
    const other = run([...started(ev), ev.sub(T0 + 10 * MINUTE, 'marco', 'hugo')]);
    expect(other.players.marco?.isGoalkeeper).toBe(false);
    expect(other.players.lucas?.isGoalkeeper).toBe(true);
  });

  it('los cambios en el descanso no suman hasta la 2ª parte', () => {
    const { ev, t, events } = typicalMatch();
    const sub = ev.sub(t.halftime + 3 * MINUTE, 'marco', 'lucas', pos(0));
    const atHalftime = reduceMatch(f7Config(), [...events.slice(0, 5), sub]);
    expect(atHalftime.status).toBe('HALFTIME');
    expect(atHalftime.intervals.find((i) => i.playerId === 'marco')).toMatchObject({ startedAt: sub.timestamp, endedAt: null });
    const state = applyEvent(atHalftime, ev.nextPeriod(t.second));
    expect(playerPlayedMs(state, 'marco', t.second - 1)).toBe(0);
    expect(playerPlayedMs(state, 'marco', t.second + 5 * MINUTE)).toBe(5 * MINUTE);
    expect(playerPlayedMs(state, 'lucas', t.second + 5 * MINUTE)).toBe(25 * MINUTE);
  });

  it('un jugador que entra y sale cinco veces acumula N intervalos y la suma correcta', () => {
    const ev = new EventFactory();
    const events: MatchEvent[] = [ev.lineup(T0, STARTERS), ev.start(T0)];
    for (let i = 0; i < 5; i++) {
      const base = T0 + i * 4 * MINUTE;
      events.push(ev.sub(base + MINUTE, 'marco', 'lucas', pos(0)), ev.sub(base + 3 * MINUTE, 'lucas', 'marco', pos(0)));
    }
    const state = run(events);
    const marco = state.intervals.filter((i) => i.playerId === 'marco');
    expect(marco).toHaveLength(5);
    expect(marco.every((i) => i.endedAt != null)).toBe(true);
    expect(state.players.marco?.entries).toBe(5);
    expect(state.players.lucas?.entries).toBe(5);
    expect(state.players.lucas?.wasStarter).toBe(true);
    const now = T0 + 20 * MINUTE;
    expect(playerPlayedMs(state, 'marco', now)).toBe(10 * MINUTE);
    expect(playerPlayedMs(state, 'lucas', now)).toBe(10 * MINUTE);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('PLAYER_ENTERED y PLAYER_LEFT abren y cierran intervalos con el partido en marcha', () => {
    const ev = new EventFactory();
    const kickoff = started(ev);
    const leave = ev.leave(T0 + 5 * MINUTE, 'alex');
    const enter = ev.enter(T0 + 8 * MINUTE, 'david', pos(6));
    const state = run([...kickoff, leave, enter]);
    expect(state.intervals.find((i) => i.playerId === 'alex')).toMatchObject({ endedAt: leave.timestamp, endEventId: leave.id });
    expect(state.intervals.find((i) => i.playerId === 'david')).toMatchObject({ startedAt: enter.timestamp, startEventId: enter.id });
    expect(state.players.david).toMatchObject({ location: 'FIELD', entries: 1 });
    expect(state.players.alex).toMatchObject({ location: 'BENCH', position: null });
  });

  it('FIELD_FULL con 7 en el campo; la sustitución no tiene ese límite', () => {
    const ev = new EventFactory();
    const full = run(started(ev));
    expect(ruleCode(() => applyEvent(full, ev.enter(T0 + 1, 'marco')))).toBe('FIELD_FULL');
    expect(ruleCode(() => applyEvent(full, ev.sub(T0 + 1, 'marco', 'lucas')))).toBeNull();
    const six = applyEvent(full, ev.leave(T0 + 1, 'alex'));
    expect(ruleCode(() => applyEvent(six, ev.enter(T0 + 2, 'marco')))).toBeNull();
  });

  it('códigos de error de jugadores', () => {
    const ev = new EventFactory();
    const state = run(started(ev));
    expect(ruleCode(() => applyEvent(state, ev.enter(T0, 'fantasma')))).toBe('UNKNOWN_PLAYER');
    expect(ruleCode(() => applyEvent(state, ev.sub(T0, 'marco', 'fantasma')))).toBe('UNKNOWN_PLAYER');
    expect(ruleCode(() => applyEvent(state, ev.goalkeeper(T0, 'fantasma')))).toBe('UNKNOWN_PLAYER');
    expect(ruleCode(() => applyEvent(state, ev.make('PLAYER_LEFT', T0, { playerId: null })))).toBe('UNKNOWN_PLAYER');
    expect(ruleCode(() => applyEvent(state, ev.sub(T0, 'lucas', 'hugo')))).toBe('PLAYER_ALREADY_ON_FIELD');
    expect(ruleCode(() => applyEvent(state, ev.leave(T0, 'marco')))).toBe('PLAYER_NOT_ON_FIELD');
    expect(ruleCode(() => applyEvent(state, ev.sub(T0, 'marco', 'adrian')))).toBe('PLAYER_NOT_ON_FIELD');
    expect(ruleCode(() => applyEvent(state, ev.move(T0, 'marco', pos(0))))).toBe('PLAYER_NOT_ON_FIELD');
    expect(ruleCode(() => applyEvent(state, ev.swap(T0, 'lucas', 'marco')))).toBe('PLAYER_NOT_ON_FIELD');
    expect(ruleCode(() => applyEvent(state, ev.swap(T0, 'lucas', 'lucas')))).toBe('INVALID_EVENT');
    expect(ruleCode(() => applyEvent(state, ev.move(T0, 'lucas', { x: 2, y: 0 })))).toBe('INVALID_POSITION');
    expect(ruleCode(() => applyEvent(state, ev.move(T0, 'lucas', { x: Number.NaN, y: 0 })))).toBe('INVALID_POSITION');
    expect(ruleCode(() => applyEvent(state, ev.sub(T0, 'marco', 'lucas', { x: 0, y: -0.1 })))).toBe('INVALID_POSITION');
    const foreign = { ...ev.goal(T0, 'lucas'), matchId: 'otro-partido' };
    expect(ruleCode(() => applyEvent(state, foreign))).toBe('INVALID_EVENT');
  });

  it('PLAYER_MOVED y PLAYERS_SWAPPED cambian posiciones sin tocar intervalos', () => {
    const ev = new EventFactory();
    const before = run(started(ev));
    const moved = applyEvent(before, ev.move(T0 + 1, 'lucas', pos(9)));
    expect(moved.players.lucas?.position).toEqual(pos(9));
    const swapped = applyEvent(moved, ev.swap(T0 + 2, 'lucas', 'hugo'));
    expect(swapped.players.lucas?.position).toEqual(pos(1));
    expect(swapped.players.hugo?.position).toEqual(pos(9));
    expect(swapped.intervals).toEqual(before.intervals);
    expect(swapped.players.lucas?.entries).toBe(0);
  });

  it('GOALKEEPER_SET deja un único portero', () => {
    const ev = new EventFactory();
    const state = run([...started(ev), ev.goalkeeper(T0 + 1, 'hugo')]);
    expect(Object.values(state.players).filter((p) => p.isGoalkeeper).map((p) => p.playerId)).toEqual(['hugo']);
  });

  it('PLAYER_ADDED: tarde solo si el partido ya empezó; no se puede repetir; luego puede entrar', () => {
    const ev = new EventFactory();
    const early = run([ev.add(T0, 'nico')]);
    expect(early.players.nico).toMatchObject({ location: 'BENCH', addedLate: false });

    const late = run([...started(ev), ev.add(T0 + 10 * MINUTE, 'nico')]);
    expect(late.players.nico).toMatchObject({ location: 'BENCH', addedLate: true, entries: 0 });
    expect(ruleCode(() => applyEvent(late, ev.add(T0 + 11 * MINUTE, 'nico')))).toBe('INVALID_EVENT');
    expect(ruleCode(() => applyEvent(late, ev.add(T0 + 11 * MINUTE, 'lucas')))).toBe('INVALID_EVENT');

    const entered = applyEvent(late, ev.sub(T0 + 12 * MINUTE, 'nico', 'lucas', pos(0)));
    expect(entered.players.nico).toMatchObject({ location: 'FIELD', entries: 1 });
    expect(playerPlayedMs(entered, 'nico', T0 + 20 * MINUTE)).toBe(8 * MINUTE);
    expect(checkInvariants(entered)).toEqual([]);
  });

  it('PLAYER_UNAVAILABLE fija y limpia el motivo sin mover al jugador', () => {
    const ev = new EventFactory();
    const injured = run([...started(ev), ev.unavailable(T0 + 1, 'lucas', 'INJURY')]);
    expect(injured.players.lucas).toMatchObject({ unavailable: 'INJURY', location: 'FIELD' });
    const cleared = applyEvent(injured, ev.unavailable(T0 + 2, 'lucas', null));
    expect(cleared.players.lucas?.unavailable).toBeNull();
    const noReason = applyEvent(cleared, ev.make('PLAYER_UNAVAILABLE', T0 + 3, { playerId: 'lucas', metadata: { unavailable: true, reason: null } }));
    expect(noReason.players.lucas?.unavailable).toBe('OTHER');
  });
});

describe('eventos que no tocan el estado', () => {
  it('GOAL y eventos de cámara solo avanzan lastSeq', () => {
    const ev = new EventFactory();
    const base = run([ev.lineup(T0, STARTERS), ev.start(T0)]);
    const afterGoal = applyEvent(base, ev.goal(T0 + MINUTE, 'lucas'));
    const afterCamera = applyEvent(afterGoal, ev.cameraStarted(T0 + 2 * MINUTE));
    expect(afterCamera.lastSeq).toBe(4);
    expect({ ...afterCamera, lastSeq: 0 }).toEqual({ ...base, lastSeq: 0 });
  });

  it('los eventos anulados se ignoran (deshacer = como si nunca hubiera ocurrido)', () => {
    const ev = new EventFactory();
    const prefix = [ev.lineup(T0, STARTERS), ev.start(T0)];
    const sub = ev.sub(T0 + 10 * MINUTE, 'marco', 'lucas');
    const undone = ev.undone(T0 + 10 * MINUTE + 20 * SECOND, sub.id);
    const withUndo = run([...prefix, voided(sub, undone.timestamp), undone]);
    const without = run(prefix);
    expect({ ...withUndo, lastSeq: 0 }).toEqual({ ...without, lastSeq: 0 });
    expect(withUndo.lastSeq).toBe(4);
    expect(playerPlayedMs(withUndo, 'lucas', T0 + 10 * MINUTE + 20 * SECOND)).toBe(10 * MINUTE + 20 * SECOND);
    expect(playerPlayedMs(withUndo, 'marco', T0 + 10 * MINUTE + 20 * SECOND)).toBe(0);
  });

  it('un evento anulado nunca es inválido, aunque lo fuera para el estado actual', () => {
    const ev = new EventFactory();
    const draft = run([]);
    expect(ruleCode(() => applyEvent(draft, voided(ev.pause(T0))))).toBeNull();
  });

  it('validateEvent admite eventos sin efecto en cualquier estado, también FINISHED', () => {
    const { ev, states } = statesByStatus();
    expect(() => validateEvent(states.FINISHED, ev.goal(T0, 'lucas'))).not.toThrow();
    expect(() => validateEvent(states.FINISHED, ev.cameraStarted(T0))).not.toThrow();
    expect(() => validateEvent(states.FINISHED, ev.undone(T0, 'evt-001'))).not.toThrow();
    expect(ruleCode(() => validateEvent(states.FINISHED, { ...ev.goal(T0, 'lucas'), matchId: 'otro' }))).toBe('INVALID_EVENT');
    expect(ruleCode(() => validateEvent(states.DRAFT, ev.start(T0)))).toBe('INVALID_STATUS');
  });

  it('lastSeq es el máximo visto', () => {
    const ev = new EventFactory();
    const e1 = ev.lineup(T0, STARTERS);
    const e2 = ev.goal(T0, 'lucas');
    const state = applyEvent(applyEvent(createInitialState(f7Config()), e2), e1);
    expect(state.lastSeq).toBe(2);
  });
});

describe('reduceMatch', () => {
  it('ordena por seq aunque el array venga desordenado', () => {
    const { events } = typicalMatch();
    const shuffled = [events[3], events[6], events[0], events[5], events[1], events[4], events[2]] as MatchEvent[];
    expect(reduceMatch(f7Config(), shuffled)).toEqual(reduceMatch(f7Config(), events));
    expect(reduceMatch(f7Config(), shuffled).status).toBe('FINISHED');
  });
});

describe('pureza de applyEvent', () => {
  it('no muta el estado de entrada', () => {
    const ev = new EventFactory();
    const state = deepFreeze(run([ev.lineup(T0, STARTERS, 'lucas'), ev.start(T0)]));
    const snapshot = JSON.stringify(state);
    const next = applyEvent(state, ev.sub(T0 + MINUTE, 'marco', 'lucas'));
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(next).not.toBe(state);
    expect(next.players.marco?.location).toBe('FIELD');
    expect(state.players.marco?.location).toBe('BENCH');
  });
});

describe('ejemplo numérico del doc 03', () => {
  it('Lucas juega 12:30, sale, vuelve y juega 8:15 → 20:45', () => {
    const ev = new EventFactory();
    const events = [
      ev.lineup(T0, STARTERS),
      ev.start(T0),
      ev.sub(T0 + 12 * MINUTE + 30 * SECOND, 'marco', 'lucas', pos(0)),
      ev.sub(T0 + 16 * MINUTE, 'lucas', 'marco', pos(0)),
    ];
    const state = run(events);
    const now = T0 + 24 * MINUTE + 15 * SECOND;
    const lucas = playerPlayedMs(state, 'lucas', now);
    expect(lucas).toBe(20 * MINUTE + 45 * SECOND);
    expect(formatClock(lucas)).toBe('20:45');
    expect(formatClock(playerPlayedMs(state, 'marco', now))).toBe('03:30');
  });
});
