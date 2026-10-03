import fc from 'fast-check';
import type { MatchEvent } from '../events';
import type { MatchState } from '../state';
import { applyEvent, createInitialState, reduceMatch } from '../reducer';
import { checkInvariants } from '../invariants';
import { matchClockMs, playerPlayedMs } from '../time';
import { EventFactory, MINUTE, T0, deepFreeze, f7Config, pos, voided } from './helpers';

/**
 * Tests por propiedades (docs/03 §3.7.8): secuencias aleatorias de comandos
 * VÁLIDOS para el estado actual, con timestamps crecientes y saltos aleatorios.
 * El generador no sabe de reglas más que lo justo para proponer acciones
 * aplicables; si el reducer las rechaza, la propiedad falla y se ve el porqué.
 */

const NUM_RUNS = 300;
const LATE_PLAYERS = ['nico', 'ivan', 'sergio', 'bruno'];

interface Step {
  action: number;
  who: number;
  gap: number;
}

// Sin sesgo y con `size: 'max'`: por defecto fast-check tiende a números
// pequeños y secuencias cortas, y eso elegiría casi siempre las primeras
// acciones y generaría partidos que nunca llegan a empezar.
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

  // Reloj primero y con más peso: queremos partidos que empiezan, descansan y acaban.
  if (status === 'READY' && field.length) actions.push(() => ev.start(t), () => ev.start(t), () => ev.start(t));
  if (status === 'RUNNING') actions.push(() => ev.pause(t));
  if (status === 'PAUSED') actions.push(() => ev.resume(t), () => ev.resume(t));
  if ((status === 'RUNNING' || status === 'PAUSED') && state.currentPeriod < state.config.periodsCount) {
    actions.push(() => ev.halftime(t), () => ev.halftime(t));
  }
  if (status === 'HALFTIME') actions.push(() => ev.nextPeriod(t), () => ev.nextPeriod(t), () => ev.nextPeriod(t));
  // FINALIZAR es raro: si no, la mayoría de las secuencias acabarían enseguida.
  if (started && who % 5 === 0) actions.push(() => ev.end(t, who % 2 ? 'SUSPENDED' : 'NORMAL'));

  // Siempre posibles: no tocan el estado.
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

interface Simulation {
  config: ReturnType<typeof f7Config>;
  ev: EventFactory;
  events: MatchEvent[];
  state: MatchState;
  t: number;
}

/** Ejecuta los pasos y llama a `check` tras cada evento con el estado anterior y el nuevo. */
function simulate(
  steps: readonly Step[],
  check?: (prev: MatchState, event: MatchEvent, next: MatchState, t: number) => void,
  freeze = false,
): Simulation {
  const config = f7Config();
  const ev = new EventFactory();
  const events: MatchEvent[] = [];
  let state = createInitialState(config);
  let t = T0;
  for (const step of steps) {
    t += step.gap;
    const actions = applicableActions(state, t, ev, step.who);
    const action = actions[step.action % actions.length];
    if (!action) throw new Error('sin acciones aplicables');
    const event = action();
    if (freeze) deepFreeze(state);
    const prev = state;
    state = applyEvent(state, event);
    events.push(event);
    check?.(prev, event, state, t);
  }
  return { config, ev, events, state, t };
}

const withoutSeq = (state: MatchState) => ({ ...state, lastSeq: 0 });

describe('propiedades del motor del partido', () => {
  it('las invariantes se cumplen tras cada evento', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        simulate(steps, (_prev, event, next) => {
          const problems = checkInvariants(next);
          if (problems.length) throw new Error(`tras ${event.type} (seq ${event.seq}): ${problems.join('; ')}`);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Σ minutos ≤ jugadores en campo × reloj, y nadie supera el reloj', () => {
    fc.assert(
      fc.property(stepsArb, fc.integer({ min: 0, max: 10 * MINUTE }), (steps, extra) => {
        simulate(steps, (_prev, _event, next, t) => {
          const now = t + extra;
          const clock = matchClockMs(next.clockSegments, now);
          let total = 0;
          for (const playerId of Object.keys(next.players)) {
            const played = playerPlayedMs(next, playerId, now);
            expect(played).toBeGreaterThanOrEqual(0);
            expect(played).toBeLessThanOrEqual(clock);
            total += played;
          }
          expect(total).toBeLessThanOrEqual(next.config.playersOnField * clock);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('anular el último evento y volver a reducir equivale a no haberlo aplicado nunca', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        const { config, ev, events, t } = simulate(steps);
        const last = events[events.length - 1];
        if (!last) return;
        const rest = events.slice(0, -1);
        const undoneAt = t + 1;
        const withUndo = reduceMatch(config, [...rest, voided(last, undoneAt), ev.undone(undoneAt, last.id)]);
        expect(withoutSeq(withUndo)).toEqual(withoutSeq(reduceMatch(config, rest)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('applyEvent no muta el estado de entrada', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        // El estado va congelado en profundidad: cualquier escritura lanzaría.
        simulate(
          steps,
          (prev, _event, next) => {
            expect(Object.isFrozen(prev)).toBe(true);
            if (next !== prev) expect(next).not.toBe(prev);
          },
          true,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reduceMatch da el mismo estado con los eventos en cualquier orden', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        const { config, events, state } = simulate(steps);
        expect(reduceMatch(config, [...events].reverse())).toEqual(state);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
