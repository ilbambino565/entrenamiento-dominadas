import fc from 'fast-check';
import type { MatchEvent } from '../events';
import type { ClockSegment, MatchState, PlayerInterval } from '../state';
import { applyEvent, createInitialState } from '../reducer';
import { checkInvariants } from '../invariants';
import { deriveEventFields } from '../derive';
import { formatClock, matchClockMs, overlapMs, playedMs, playerPlayedMs, toMatchTimeMs } from '../time';
import { EventFactory, MINUTE, SECOND, STARTERS, T0, f7Config, pos, run } from './helpers';

/**
 * Revisión de la dimensión "cálculo de tiempos y reducer" (docs/03 §3.3 y §3.6).
 *
 * Dos bloques:
 * - "verificado": casos límite que el código resuelve bien y que los tests
 *   existentes no cubrían (quedan como red de seguridad).
 * - "HALLAZGO": comportamientos que contradicen las propiedades del doc
 *   (§2.5.2 intervalos de un jugador sin solapar; §3.7.8 Σ minutos ≤ jugadores
 *   × reloj) cuando el reloj del sistema salta hacia atrás. Fallan a propósito:
 *   documentan el defecto hasta que se corrija.
 */

const at = (offsetMs: number): number => T0 + offsetMs;

const seg = (period: number, start: number, end: number | null): ClockSegment => ({
  period,
  startedAt: at(start),
  endedAt: end == null ? null : at(end),
});

const iv = (playerId: string, start: number, end: number | null): PlayerInterval => ({
  playerId,
  startedAt: at(start),
  endedAt: end == null ? null : at(end),
  startEventId: 'evt-in',
  endEventId: end == null ? null : 'evt-out',
});

/**
 * La propiedad de abajo (200 partidos aleatorios) roza los 5 s por defecto
 * cuando toda la suite corre en paralelo: se le da margen en vez de bajar
 * las ejecuciones.
 */
const PROPERTY_TIMEOUT_MS = 30_000;

describe('verificado: ejemplo 12:30 + 8:15 = 20:45 a mano, con pausa dentro del segundo tramo', () => {
  it('la pausa entre medias no suma y el total sigue siendo 20:45', () => {
    const ev = new EventFactory();
    // Lucas: 0:00–12:30 en campo (12:30). Sale. Vuelve a las 16:00 reales.
    // Pausa 18:00–20:00. now = 26:15 real → segundo tramo = 2:00 + 6:15 = 8:15.
    const state = run([
      ev.lineup(T0, STARTERS),
      ev.start(T0),
      ev.sub(at(12 * MINUTE + 30 * SECOND), 'marco', 'lucas', pos(0)),
      ev.sub(at(16 * MINUTE), 'lucas', 'marco', pos(0)),
      ev.pause(at(18 * MINUTE)),
      ev.resume(at(20 * MINUTE)),
    ]);
    const now = at(26 * MINUTE + 15 * SECOND);
    const lucas = playerPlayedMs(state, 'lucas', now);
    expect(lucas).toBe(12 * MINUTE + 30 * SECOND + 8 * MINUTE + 15 * SECOND);
    expect(formatClock(lucas)).toBe('20:45');
    // Reloj del partido: 26:15 reales − 2:00 de pausa = 24:15.
    expect(matchClockMs(state.clockSegments, now)).toBe(24 * MINUTE + 15 * SECOND);
    // Marco: 12:30 → 16:00 = 3:30.
    expect(formatClock(playerPlayedMs(state, 'marco', now))).toBe('03:30');
  });
});

describe('verificado: límites de overlapMs / toMatchTimeMs con now anterior a los tramos', () => {
  it('now anterior a startedAt de todo: reloj 0, jugadores 0, nada negativo', () => {
    const segments = [seg(1, 10 * MINUTE, null)];
    const intervals = [iv('lucas', 10 * MINUTE, null), iv('hugo', 10 * MINUTE, 12 * MINUTE)];
    const now = at(5 * MINUTE);
    expect(matchClockMs(segments, now)).toBe(0);
    expect(playedMs(intervals, segments, now)).toBe(0);
    expect(toMatchTimeMs(segments, now)).toBe(0);
  });

  it('intervalo cerrado + segmento abierto con now anterior al cierre del intervalo: se acota a now', () => {
    expect(overlapMs({ start: at(0), end: at(10 * MINUTE) }, { start: at(0), end: null }, at(6 * MINUTE))).toBe(6 * MINUTE);
  });

  it('segmento cerrado invertido (endedAt < startedAt) vale 0 en todas las fórmulas', () => {
    const inverted = [seg(1, 10 * MINUTE, 8 * MINUTE)];
    expect(matchClockMs(inverted, at(20 * MINUTE))).toBe(0);
    expect(playedMs([iv('lucas', 0, null)], inverted, at(20 * MINUTE))).toBe(0);
    expect(toMatchTimeMs(inverted, at(20 * MINUTE))).toBe(0);
  });

  it('un evento con timestamp anterior al inicio del segmento abierto (cola tardía) queda en el reloj de la pausa', () => {
    // Pausa 10'–12'. Un gesto soltado a las 11:59 reales que entra en la cola
    // después de REANUDAR: su minuto de partido es 10:00, no negativo ni 12:00.
    const segments = [seg(1, 0, 10 * MINUTE), seg(1, 12 * MINUTE, null)];
    expect(toMatchTimeMs(segments, at(11 * MINUTE + 59 * SECOND))).toBe(10 * MINUTE);
  });
});

describe('verificado: suspendido desde PAUSED congela en la pausa, no en el final', () => {
  it('MATCH_ENDED{SUSPENDED} tras una pausa: intervalos cerrados al final, minutos hasta la pausa', () => {
    const ev = new EventFactory();
    const prefix = [ev.lineup(T0, STARTERS), ev.start(T0), ev.pause(at(10 * MINUTE))];
    const end = ev.end(at(15 * MINUTE), 'SUSPENDED');
    const state = run([...prefix, end]);
    expect(state).toMatchObject({ status: 'FINISHED', endReason: 'SUSPENDED' });
    expect(state.intervals.every((i) => i.endedAt === end.timestamp)).toBe(true);
    for (const id of STARTERS) expect(playerPlayedMs(state, id, at(60 * MINUTE))).toBe(10 * MINUTE);
    expect(matchClockMs(state.clockSegments, at(60 * MINUTE))).toBe(10 * MINUTE);
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('verificado: derivados tras deshacer HALFTIME_STARTED y PERIOD_STARTED', () => {
  it('anular el descanso devuelve el reloj corriendo y mueve el minuto de los eventos posteriores', () => {
    const ev = new EventFactory();
    const start = ev.start(T0);
    const halftime = ev.halftime(at(27 * MINUTE));
    const camera = ev.cameraStarted(at(30 * MINUTE));
    const before = deriveEventFields([start, halftime, camera]);
    expect(before[2]).toMatchObject({ matchTimeMs: 27 * MINUTE, period: 1 });
    const after = deriveEventFields([start, { ...halftime, voidedAt: at(31 * MINUTE) }, camera]);
    expect(after[2]).toMatchObject({ matchTimeMs: 30 * MINUTE, period: 1 });
  });

  it('anular PERIOD_STARTED devuelve al periodo 1 y al reloj del descanso', () => {
    const ev = new EventFactory();
    const start = ev.start(T0);
    const halftime = ev.halftime(at(25 * MINUTE));
    const second = ev.nextPeriod(at(35 * MINUTE));
    const goal = ev.goal(at(40 * MINUTE), 'lucas');
    const before = deriveEventFields([start, halftime, second, goal]);
    expect(before[3]).toMatchObject({ matchTimeMs: 30 * MINUTE, period: 2 });
    const after = deriveEventFields([start, halftime, { ...second, voidedAt: at(41 * MINUTE) }, goal]);
    expect(after[2]).toMatchObject({ matchTimeMs: 25 * MINUTE, period: 1 });
    expect(after[3]).toMatchObject({ matchTimeMs: 25 * MINUTE, period: 1 });
  });
});

describe('verificado: propiedad con timestamps NO monótonos (saltos del reloj del sistema)', () => {
  // Generador mínimo de secuencias válidas con `gap` que puede ser negativo.
  const stepArb = fc.record({ action: fc.nat(), who: fc.nat(), gap: fc.integer({ min: -2 * MINUTE, max: 4 * MINUTE }) });
  const stepsArb = fc.noBias(fc.array(stepArb, { minLength: 5, maxLength: 60, size: 'max' }));

  function nextEvent(state: MatchState, t: number, ev: EventFactory, who: number, action: number): MatchEvent {
    const players = Object.values(state.players);
    const field = players.filter((p) => p.location === 'FIELD').map((p) => p.playerId);
    const bench = players.filter((p) => p.location === 'BENCH').map((p) => p.playerId);
    const pick = (xs: readonly string[], salt = 0): string => xs[(who + salt) % xs.length] ?? xs[0] ?? 'lucas';
    const options: Array<() => MatchEvent> = [];
    const { status } = state;
    if (status === 'DRAFT') options.push(() => ev.lineup(t, STARTERS, 'lucas'));
    if (status === 'READY') options.push(() => ev.start(t), () => ev.start(t));
    if (status === 'RUNNING') options.push(() => ev.pause(t));
    if (status === 'PAUSED') options.push(() => ev.resume(t), () => ev.resume(t));
    if ((status === 'RUNNING' || status === 'PAUSED') && state.currentPeriod < state.config.periodsCount) {
      options.push(() => ev.halftime(t));
    }
    if (status === 'HALFTIME') options.push(() => ev.nextPeriod(t), () => ev.nextPeriod(t));
    if (status !== 'DRAFT' && status !== 'READY' && status !== 'FINISHED' && who % 7 === 0) options.push(() => ev.end(t));
    if (status !== 'FINISHED' && status !== 'DRAFT') {
      if (bench.length && field.length) options.push(() => ev.sub(t, pick(bench), pick(field, 3), pos(who % 10)));
      if (field.length) options.push(() => ev.leave(t, pick(field)));
      if (bench.length && field.length < state.config.playersOnField) options.push(() => ev.enter(t, pick(bench), pos(field.length)));
    }
    options.push(() => ev.goal(t, pick(players.map((p) => p.playerId))));
    const chosen = options[action % options.length];
    if (!chosen) throw new Error('sin acciones');
    return chosen();
  }

  it('nunca hay duraciones negativas ni invariantes rotas, y los derivados nunca son negativos', () => {
    fc.assert(
      fc.property(stepsArb, fc.integer({ min: -3 * MINUTE, max: 10 * MINUTE }), (steps, extra) => {
        const config = f7Config();
        const ev = new EventFactory();
        const events: MatchEvent[] = [];
        let state = createInitialState(config);
        let t = T0;
        for (const step of steps) {
          t += step.gap;
          const event = nextEvent(state, t, ev, step.who, step.action);
          state = applyEvent(state, event);
          events.push(event);
          const problems = checkInvariants(state);
          if (problems.length) throw new Error(`tras ${event.type} (seq ${event.seq}): ${problems.join('; ')}`);
          const now = t + extra;
          expect(matchClockMs(state.clockSegments, now)).toBeGreaterThanOrEqual(0);
          for (const id of Object.keys(state.players)) expect(playerPlayedMs(state, id, now)).toBeGreaterThanOrEqual(0);
        }
        for (const d of deriveEventFields(events)) {
          expect(d.matchTimeMs).toBeGreaterThanOrEqual(0);
          expect(d.period).toBeGreaterThanOrEqual(0);
          expect(d.period).toBeLessThanOrEqual(config.periodsCount);
        }
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT_MS);
});

describe('reloj del sistema hacia atrás', () => {
  it('intervalo abierto ∩ segmento cerrado con now < endedAt: la fórmula pura cierra el intervalo en now', () => {
    // Pausa a las 10:00 reales; después el móvil corrige la hora 4 min hacia
    // atrás (now = 6:00). La fórmula pura da 06:00 para Lucas y 10:00 para el
    // reloj: por eso el MatchEngine acota `now` a la última marca guardada
    // antes de consultar (ver app-services: "reloj del sistema hacia atrás").
    const segments = [seg(1, 0, 10 * MINUTE)];
    const lucas = [iv('lucas', 0, null)];
    const now = at(6 * MINUTE);
    expect(matchClockMs(segments, now)).toBe(10 * MINUTE);
    expect(playedMs(lucas, segments, now)).toBe(6 * MINUTE);
    // Con `now` acotado a la última marca (10:00) vuelven a cuadrar.
    expect(playedMs(lucas, segments, at(10 * MINUTE))).toBe(10 * MINUTE);
  });

  it('salir y volver a entrar con el reloj hacia atrás: los dos tramos solapados no se cuentan dos veces', () => {
    // Lucas sale a las 10:00 reales; el reloj del sistema retrocede 2 min y
    // vuelve a entrar a las 8:00 reales. Sus dos intervalos se solapan 2 min;
    // `playerPlayedMs` los une antes de intersecar: nadie supera el reloj
    // (§2.5.2 y §3.7.8).
    const ev = new EventFactory();
    const state = run([
      ev.lineup(T0, STARTERS),
      ev.start(T0),
      ev.leave(at(10 * MINUTE), 'lucas'),
      ev.enter(at(8 * MINUTE), 'lucas', pos(0)),
    ]);
    const now = at(20 * MINUTE);
    const clock = matchClockMs(state.clockSegments, now);
    expect(clock).toBe(20 * MINUTE);
    expect(playerPlayedMs(state, 'lucas', now)).toBe(clock);
  });
});
