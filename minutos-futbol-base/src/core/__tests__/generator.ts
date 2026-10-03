import fc from 'fast-check';
import type { MatchEvent } from '../events';
import type { MatchState } from '../state';
import { applyEvent, createInitialState, reduceMatch } from '../reducer';
import { EventFactory, MINUTE, T0, deepFreeze, f7Config, pos, voided } from './helpers';

/**
 * Generador compartido de partidos aleatorios VÁLIDOS para los tests por
 * propiedades (docs/03 §3.7.8) y para medir su propia cobertura.
 *
 * En cada paso elige una acción aplicable al estado actual (el generador solo
 * sabe de reglas lo justo para proponer algo válido; si el reductor la rechaza,
 * la propiedad falla y se ve el porqué). Incluye DESHACER en cualquier punto:
 * se anula el último evento de usuario vigente y, como hace el motor, el
 * estado se regenera desde el log.
 */

export const LATE_PLAYERS = ['nico', 'ivan', 'sergio', 'bruno'];

export interface Step {
  action: number;
  who: number;
  gap: number;
}

// Sin sesgo y con `size: 'max'`: por defecto fast-check tiende a números
// pequeños y secuencias cortas, y eso elegiría casi siempre las primeras
// acciones y generaría partidos que nunca llegan a empezar.
export const stepArb = fc.record({
  action: fc.nat(),
  who: fc.nat(),
  gap: fc.integer({ min: 0, max: 4 * MINUTE }),
});
export const stepsArb = fc.noBias(fc.array(stepArb, { minLength: 5, maxLength: 80, size: 'max' }));

export type Action = { kind: 'event'; make: () => MatchEvent } | { kind: 'undo' };

/** Último evento de usuario no anulado: lo que desharía el motor. */
export function undoTarget(events: readonly MatchEvent[]): MatchEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.source === 'user' && e.voidedAt == null) return e;
  }
  return undefined;
}

export function applicableActions(
  state: MatchState,
  events: readonly MatchEvent[],
  t: number,
  ev: EventFactory,
  who: number,
): Action[] {
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
  const event = (make: () => MatchEvent): Action => ({ kind: 'event', make });

  const actions: Action[] = [];

  // Reloj primero y con más peso: queremos partidos que empiezan, descansan y acaban.
  if (status === 'READY' && field.length) actions.push(event(() => ev.start(t)), event(() => ev.start(t)), event(() => ev.start(t)));
  if (status === 'RUNNING') actions.push(event(() => ev.pause(t)));
  if (status === 'PAUSED') actions.push(event(() => ev.resume(t)), event(() => ev.resume(t)));
  if ((status === 'RUNNING' || status === 'PAUSED') && state.currentPeriod < state.config.periodsCount) {
    actions.push(event(() => ev.halftime(t)), event(() => ev.halftime(t)));
  }
  if (status === 'HALFTIME') actions.push(event(() => ev.nextPeriod(t)), event(() => ev.nextPeriod(t)), event(() => ev.nextPeriod(t)));
  // FINALIZAR es raro: si no, la mayoría de las secuencias acabarían enseguida.
  if (started && who % 5 === 0) actions.push(event(() => ev.end(t, who % 2 ? 'SUSPENDED' : 'NORMAL')));

  // Deshacer puede llegar en cualquier momento, también después de FINALIZAR.
  if (undoTarget(events)) actions.push({ kind: 'undo' });

  // Siempre posibles: no tocan el estado.
  actions.push(event(() => ev.goal(t, choose(known))), event(() => ev.cameraStarted(t, `rec-${t}`)));
  if (status === 'FINISHED') return actions;

  if (bench.length && !full) actions.push(event(() => ev.enter(t, choose(bench), pos(field.length))));
  if (field.length) actions.push(event(() => ev.leave(t, choose(field))));
  if (bench.length && field.length) actions.push(event(() => ev.sub(t, choose(bench), choose(field, 3), pos(who % 10))));
  if (field.length) actions.push(event(() => ev.move(t, choose(field), pos(who % 10))));
  if (field.length >= 2) {
    actions.push(
      event(() => {
        const a = choose(field);
        return ev.swap(t, a, choose(field.filter((id) => id !== a), 1));
      }),
    );
  }
  actions.push(event(() => ev.goalkeeper(t, choose(known))));
  if (missing.length) actions.push(event(() => ev.add(t, choose(missing))));
  actions.push(event(() => ev.unavailable(t, choose(known), who % 2 ? 'INJURY' : null)));
  if (preMatch) {
    actions.push(
      event(() => {
        const rotation = who % known.length;
        const rotated = [...known.slice(rotation), ...known.slice(0, rotation)];
        return ev.lineup(t, rotated.slice(0, who % (state.config.playersOnField + 1)));
      }),
    );
  }
  return actions;
}

export interface SimulationStep {
  prev: MatchState;
  /** El evento aplicado; en un deshacer, el marcador EVENT_UNDONE. */
  event: MatchEvent;
  next: MatchState;
  t: number;
  /** El log completo tras el paso (con el anulado marcado, si lo hubo). */
  events: readonly MatchEvent[];
}

export interface Simulation {
  config: ReturnType<typeof f7Config>;
  ev: EventFactory;
  events: MatchEvent[];
  state: MatchState;
  t: number;
  undos: number;
}

/** Ejecuta los pasos y llama a `check` tras cada uno. */
export function simulate(
  steps: readonly Step[],
  check?: (step: SimulationStep) => void,
  freeze = false,
): Simulation {
  const config = f7Config();
  const ev = new EventFactory();
  const events: MatchEvent[] = [];
  let state = createInitialState(config);
  let t = T0;
  let undos = 0;
  for (const step of steps) {
    t += step.gap;
    const actions = applicableActions(state, events, t, ev, step.who);
    const action = actions[step.action % actions.length];
    if (!action) throw new Error('sin acciones aplicables');
    if (freeze) deepFreeze(state);
    const prev = state;
    let event: MatchEvent;
    if (action.kind === 'undo') {
      const target = undoTarget(events);
      if (!target) throw new Error('deshacer sin objetivo');
      events[events.indexOf(target)] = voided(target, t);
      event = ev.undone(t, target.id);
      events.push(event);
      // El reductor no sabe "des-aplicar": igual que el motor, se regenera desde el log.
      state = reduceMatch(config, events);
      undos += 1;
    } else {
      event = action.make();
      state = applyEvent(state, event);
      events.push(event);
    }
    check?.({ prev, event, next: state, t, events });
  }
  return { config, ev, events, state, t, undos };
}
