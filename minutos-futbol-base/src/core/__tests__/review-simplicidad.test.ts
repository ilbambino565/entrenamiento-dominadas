import fc from 'fast-check';
import type { MatchEvent, MatchEventType } from '../events';
import type { MatchState, MatchStatus } from '../state';
import { applyEvent, createInitialState } from '../reducer';
import { playerPlayedMs } from '../time';
import { EventFactory, MINUTE, STARTERS, T0, f7Config, pos, run } from './helpers';

/**
 * REVISIÓN (simplicidad y calidad de tests).
 *
 * 1. Mide la cobertura REAL del generador de `properties.test.ts` (copiado tal
 *    cual) sobre 300 secuencias: qué fracción de partidos llega a pausar,
 *    descansar, jugar la 2ª parte o acabar, cuántos cambios ocurren con el
 *    reloj parado, y qué tipo de evento es el ÚLTIMO (lo único que deshace la
 *    propiedad "anular el último evento"). Los umbrales son los medidos: si el
 *    generador cambia y deja de ejercer una rama, este test lo delata.
 * 2. docs/03 §3.6 "Jugador lesionado: si se intenta meter, vibración de aviso
 *    (no se bloquea)": no había ningún test de que un jugador marcado como no
 *    disponible pueda entrar. Aquí queda.
 */

// ───── Copia literal del generador de properties.test.ts (no se exporta de allí) ─────

const LATE_PLAYERS = ['nico', 'ivan', 'sergio', 'bruno'];

interface Step {
  action: number;
  who: number;
  gap: number;
}

const stepArb = fc.record({
  action: fc.nat(),
  who: fc.nat(),
  gap: fc.integer({ min: 0, max: 4 * MINUTE }),
});
const stepsArb = fc.noBias(fc.array(stepArb, { minLength: 5, maxLength: 80, size: 'max' }));

type Action = () => MatchEvent;

function applicableActions(state: MatchState, t: number, ev: EventFactory, who: number): Action[] {
  const players = Object.values(state.players);
  const known = players.map((p) => p.playerId);
  const field = players.filter((p) => p.location === 'FIELD').map((p) => p.playerId);
  const bench = players.filter((p) => p.location === 'BENCH').map((p) => p.playerId);
  const missing = LATE_PLAYERS.filter((id) => !state.players[id]);
  const full = field.length >= state.config.playersOnField;
  const { status } = state;
  const preMatch = status === 'DRAFT' || status === 'READY';
  const started = status === 'RUNNING' || status === 'PAUSED' || status === 'HALFTIME';

  const choose = <T,>(xs: readonly T[], salt = 0): T => {
    const x = xs[(who + salt) % xs.length];
    if (x === undefined) throw new Error('lista vacía');
    return x;
  };

  const actions: Action[] = [];
  if (status === 'READY' && field.length) actions.push(() => ev.start(t), () => ev.start(t), () => ev.start(t));
  if (status === 'RUNNING') actions.push(() => ev.pause(t));
  if (status === 'PAUSED') actions.push(() => ev.resume(t), () => ev.resume(t));
  if ((status === 'RUNNING' || status === 'PAUSED') && state.currentPeriod < state.config.periodsCount) {
    actions.push(() => ev.halftime(t), () => ev.halftime(t));
  }
  if (status === 'HALFTIME') actions.push(() => ev.nextPeriod(t), () => ev.nextPeriod(t), () => ev.nextPeriod(t));
  if (started && who % 5 === 0) actions.push(() => ev.end(t, who % 2 ? 'SUSPENDED' : 'NORMAL'));
  actions.push(() => ev.goal(t, choose(known)), () => ev.cameraStarted(t, `rec-${t}`));
  if (status === 'FINISHED') return actions;
  if (bench.length && !full) actions.push(() => ev.enter(t, choose(bench), pos(field.length)));
  if (field.length) actions.push(() => ev.leave(t, choose(field)));
  if (bench.length && field.length) actions.push(() => ev.sub(t, choose(bench), choose(field, 3), pos(who % 10)));
  if (field.length) actions.push(() => ev.move(t, choose(field), pos(who % 10)));
  if (field.length >= 2) {
    actions.push(() => {
      const a = choose(field);
      return ev.swap(t, a, choose(field.filter((id) => id !== a), 1));
    });
  }
  actions.push(() => ev.goalkeeper(t, choose(known)));
  if (missing.length) actions.push(() => ev.add(t, choose(missing)));
  actions.push(() => ev.unavailable(t, choose(known), who % 2 ? 'INJURY' : null));
  if (preMatch) {
    actions.push(() => {
      const rotation = who % known.length;
      const rotated = [...known.slice(rotation), ...known.slice(0, rotation)];
      return ev.lineup(t, rotated.slice(0, who % (state.config.playersOnField + 1)));
    });
  }
  return actions;
}

// ───── Instrumentación ─────

const MOVEMENT: readonly MatchEventType[] = ['PLAYER_ENTERED', 'PLAYER_LEFT', 'SUBSTITUTION'];

interface RunStats {
  types: Set<MatchEventType>;
  movementWhilePaused: number;
  movementWhileHalftime: number;
  lastType: MatchEventType;
  lastIsClock: boolean;
  lastIsMovement: boolean;
  events: number;
}

function simulateWithStats(steps: readonly Step[]): RunStats {
  const ev = new EventFactory();
  let state = createInitialState(f7Config());
  let t = T0;
  const types = new Set<MatchEventType>();
  let movementWhilePaused = 0;
  let movementWhileHalftime = 0;
  let last: MatchEvent | undefined;
  for (const step of steps) {
    t += step.gap;
    const actions = applicableActions(state, t, ev, step.who);
    const action = actions[step.action % actions.length];
    if (!action) throw new Error('sin acciones aplicables');
    const event = action();
    const before: MatchStatus = state.status;
    state = applyEvent(state, event);
    types.add(event.type);
    if (MOVEMENT.includes(event.type) && before === 'PAUSED') movementWhilePaused += 1;
    if (MOVEMENT.includes(event.type) && before === 'HALFTIME') movementWhileHalftime += 1;
    last = event;
  }
  if (!last) throw new Error('secuencia vacía');
  const CLOCK: readonly MatchEventType[] = ['MATCH_STARTED', 'MATCH_PAUSED', 'MATCH_RESUMED', 'HALFTIME_STARTED', 'PERIOD_STARTED', 'MATCH_ENDED'];
  return {
    types,
    movementWhilePaused,
    movementWhileHalftime,
    lastType: last.type,
    lastIsClock: CLOCK.includes(last.type),
    lastIsMovement: MOVEMENT.includes(last.type),
    events: steps.length,
  };
}

describe('review-simplicidad: cobertura real del generador de properties.test.ts (300 secuencias, semilla fija)', () => {
  const SAMPLES = 300;
  const runs = fc.sample(stepsArb, { numRuns: SAMPLES, seed: 2024 }).map(simulateWithStats);
  const share = (pred: (r: RunStats) => boolean): number => runs.filter(pred).length / runs.length;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const coverage = {
    started: share((r) => r.types.has('MATCH_STARTED')),
    paused: share((r) => r.types.has('MATCH_PAUSED')),
    resumed: share((r) => r.types.has('MATCH_RESUMED')),
    halftime: share((r) => r.types.has('HALFTIME_STARTED')),
    secondPeriod: share((r) => r.types.has('PERIOD_STARTED')),
    ended: share((r) => r.types.has('MATCH_ENDED')),
    movementWhilePaused: share((r) => r.movementWhilePaused > 0),
    movementWhileHalftime: share((r) => r.movementWhileHalftime > 0),
    lateAdded: share((r) => r.types.has('PLAYER_ADDED')),
    lastEventIsClock: share((r) => r.lastIsClock),
    lastEventIsMovement: share((r) => r.lastIsMovement),
    lastEventIsNoOp: share((r) => r.lastType === 'GOAL' || r.lastType === 'CAMERA_RECORDING_STARTED'),
  };

  it('imprime la cobertura medida (dato para el revisor)', () => {
    const lines = Object.entries(coverage).map(([k, v]) => `${k.padEnd(24)} ${pct(v)}`);
    const avgEvents = runs.reduce((acc, r) => acc + r.events, 0) / runs.length;
    console.info(`[review-simplicidad] cobertura del generador sobre ${SAMPLES} secuencias (media ${avgEvents.toFixed(1)} eventos):\n` + lines.join('\n'));
    expect(runs).toHaveLength(SAMPLES);
  });

  it('las ramas difíciles (pausa, descanso, 2ª parte, final) se ejercen en una fracción apreciable de partidos', () => {
    expect(coverage.started).toBeGreaterThan(0.9);
    expect(coverage.paused).toBeGreaterThan(0.5);
    expect(coverage.resumed).toBeGreaterThan(0.4);
    expect(coverage.halftime).toBeGreaterThan(0.5);
    expect(coverage.secondPeriod).toBeGreaterThan(0.4);
    expect(coverage.ended).toBeGreaterThan(0.2);
  });

  it('los cambios con el reloj parado (pausa / descanso) ocurren en bastantes partidos', () => {
    expect(coverage.movementWhilePaused).toBeGreaterThan(0.25);
    expect(coverage.movementWhileHalftime).toBeGreaterThan(0.25);
  });

  it('OBSERVACIÓN: la propiedad "anular el último evento" deshace casi siempre algo trivial', () => {
    // properties.test.ts solo anula el ÚLTIMO evento de cada secuencia. Medido:
    // en ~49% de los partidos ese evento es un GOAL o CAMERA_RECORDING_STARTED
    // (no toca el estado: la propiedad es cierta por construcción) y solo en
    // ~12% es un evento de reloj (pausa, descanso, inicio, final), que es donde
    // deshacer tiene efectos no triviales (segmentos, intervalos, derivados).
    // Deshacer encadenado o en mitad de la secuencia no se genera nunca ahí.
    expect(coverage.lastEventIsNoOp).toBeGreaterThan(0.4);
    expect(coverage.lastEventIsClock).toBeLessThan(0.2);
  });
});

describe('review-simplicidad: docs/03 §3.6 jugador lesionado "no se bloquea"', () => {
  it('un jugador marcado como no disponible puede entrar y suma minutos; el marcador se conserva', () => {
    const ev = new EventFactory();
    const state = run([
      ev.lineup(T0, STARTERS, 'lucas'),
      ev.start(T0),
      ev.unavailable(T0 + MINUTE, 'marco', 'INJURY'),
      ev.sub(T0 + 2 * MINUTE, 'marco', 'lucas', pos(0)),
    ]);
    expect(state.players.marco).toMatchObject({ location: 'FIELD', unavailable: 'INJURY', entries: 1 });
    expect(playerPlayedMs(state, 'marco', T0 + 5 * MINUTE)).toBe(3 * MINUTE);
  });
});
