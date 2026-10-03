import fc from 'fast-check';
import { reduceMatch } from '../reducer';
import { checkInvariants } from '../invariants';
import { deriveEventFields } from '../derive';
import { matchClockMs, playerPlayedMs } from '../time';
import { MINUTE, voided } from './helpers';
import { simulate, stepsArb } from './generator';

/**
 * Tests por propiedades (docs/03 §3.7.8) sobre partidos aleatorios válidos con
 * pausas, descansos, cambios con el reloj parado, jugadores que llegan tarde y
 * DESHACER en cualquier punto (ver generator.ts).
 *
 * `PROPERTY_RUNS` sube el número de ejecuciones (`npm run test:props` usa
 * 2 000 por propiedad; el roadmap pide > 10 000 secuencias acumuladas).
 */

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = Number(env?.PROPERTY_RUNS) || 300;

describe('propiedades del motor del partido', () => {
  it('las invariantes se cumplen tras cada evento, también tras deshacer', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        simulate(steps, ({ event, next }) => {
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
        simulate(steps, ({ next, t }) => {
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

  it('el estado incremental coincide con regenerar desde el log en cada paso', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        simulate(steps, ({ next, events }) => {
          expect(reduceMatch(next.config, events)).toEqual(next);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('los campos derivados son idempotentes y acotados (0 ≤ matchTimeMs, 0 ≤ period ≤ partes)', () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        const { config, events } = simulate(steps);
        const once = deriveEventFields(events);
        expect(deriveEventFields(once)).toEqual(once);
        for (const e of once) {
          expect(e.matchTimeMs).toBeGreaterThanOrEqual(0);
          expect(e.period).toBeGreaterThanOrEqual(0);
          expect(e.period).toBeLessThanOrEqual(config.periodsCount);
        }
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
        const withoutSeq = (s: typeof withUndo) => ({ ...s, lastSeq: 0 });
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
          ({ prev, next }) => {
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
