import fc from 'fast-check';
import type { MatchEventType } from '../events';
import { playerPlayedMs } from '../time';
import { simulate, stepsArb } from './generator';
import { EventFactory, MINUTE, STARTERS, T0, pos, run } from './helpers';

/**
 * Mide la cobertura REAL del generador de properties.test.ts con semilla fija:
 * qué fracción de partidos llega a pausar, descansar, jugar la 2ª parte,
 * acabar, hacer cambios con el reloj parado y deshacer (también eventos de
 * reloj). Si el generador cambia y deja de ejercer una rama, este test lo
 * delata antes de que las propiedades pasen "por construcción".
 */

const MOVEMENT: readonly MatchEventType[] = ['PLAYER_ENTERED', 'PLAYER_LEFT', 'SUBSTITUTION'];
const CLOCK: readonly MatchEventType[] = [
  'MATCH_STARTED',
  'MATCH_PAUSED',
  'MATCH_RESUMED',
  'HALFTIME_STARTED',
  'PERIOD_STARTED',
  'MATCH_ENDED',
];

interface RunStats {
  types: Set<MatchEventType>;
  movementWhilePaused: number;
  movementWhileHalftime: number;
  undos: number;
  clockUndos: number;
  events: number;
}

function statsOf(steps: Parameters<typeof simulate>[0]): RunStats {
  const types = new Set<MatchEventType>();
  let movementWhilePaused = 0;
  let movementWhileHalftime = 0;
  let clockUndos = 0;
  const sim = simulate(steps, ({ prev, event, events }) => {
    types.add(event.type);
    if (MOVEMENT.includes(event.type) && prev.status === 'PAUSED') movementWhilePaused += 1;
    if (MOVEMENT.includes(event.type) && prev.status === 'HALFTIME') movementWhileHalftime += 1;
    if (event.type === 'EVENT_UNDONE') {
      const targetId = (event.metadata as { targetEventId: string }).targetEventId;
      const target = events.find((e) => e.id === targetId);
      if (target && CLOCK.includes(target.type)) clockUndos += 1;
    }
  });
  return { types, movementWhilePaused, movementWhileHalftime, undos: sim.undos, clockUndos, events: steps.length };
}

describe('cobertura del generador de partidos aleatorios (300 secuencias, semilla fija)', () => {
  const SAMPLES = 300;
  const runs = fc.sample(stepsArb, { numRuns: SAMPLES, seed: 2024 }).map(statsOf);
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
    undone: share((r) => r.undos > 0),
    undoneTwice: share((r) => r.undos > 1),
    clockUndone: share((r) => r.clockUndos > 0),
  };

  it('imprime la cobertura medida', () => {
    const lines = Object.entries(coverage).map(([k, v]) => `${k.padEnd(24)} ${pct(v)}`);
    const avgEvents = runs.reduce((acc, r) => acc + r.events, 0) / runs.length;
    console.info(`[generator] cobertura sobre ${SAMPLES} secuencias (media ${avgEvents.toFixed(1)} eventos):\n` + lines.join('\n'));
    expect(runs).toHaveLength(SAMPLES);
  });

  it('las ramas difíciles (pausa, descanso, 2ª parte, final) se ejercen en una fracción apreciable de partidos', () => {
    expect(coverage.started).toBeGreaterThan(0.85);
    expect(coverage.paused).toBeGreaterThan(0.45);
    expect(coverage.resumed).toBeGreaterThan(0.35);
    expect(coverage.halftime).toBeGreaterThan(0.45);
    expect(coverage.secondPeriod).toBeGreaterThan(0.35);
    expect(coverage.ended).toBeGreaterThan(0.15);
  });

  it('los cambios con el reloj parado (pausa / descanso) ocurren en bastantes partidos', () => {
    expect(coverage.movementWhilePaused).toBeGreaterThan(0.2);
    expect(coverage.movementWhileHalftime).toBeGreaterThan(0.2);
  });

  it('deshacer se ejerce de verdad: en mitad del partido, encadenado y sobre eventos de reloj', () => {
    expect(coverage.undone).toBeGreaterThan(0.6);
    expect(coverage.undoneTwice).toBeGreaterThan(0.3);
    expect(coverage.clockUndone).toBeGreaterThan(0.2);
  });
});

describe('docs/03 §3.6: jugador lesionado "no se bloquea"', () => {
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
