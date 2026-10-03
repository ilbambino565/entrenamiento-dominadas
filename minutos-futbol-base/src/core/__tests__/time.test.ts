import type { ClockSegment, PlayerInterval } from '../state';
import {
  formatClock,
  fromMatchTimeMs,
  matchClockMs,
  overlapMs,
  periodClockMs,
  playedMs,
  playedShare,
  playerPlayedMs,
  toMatchTimeMs,
} from '../time';
import { createInitialState } from '../reducer';
import { MINUTE, SECOND, T0, f7Config } from './helpers';

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

describe('overlapMs', () => {
  it('es 0 cuando los tramos no se tocan', () => {
    expect(overlapMs({ start: 0, end: 10 }, { start: 10, end: 20 }, 100)).toBe(0);
    expect(overlapMs({ start: 0, end: 10 }, { start: 50, end: 60 }, 100)).toBe(0);
  });

  it('calcula solapamientos parciales y contenidos', () => {
    expect(overlapMs({ start: 0, end: 10 }, { start: 5, end: 20 }, 100)).toBe(5);
    expect(overlapMs({ start: 0, end: 30 }, { start: 10, end: 20 }, 100)).toBe(10);
  });

  it('cierra los tramos abiertos en now', () => {
    expect(overlapMs({ start: 0, end: null }, { start: 10, end: null }, 25)).toBe(15);
    expect(overlapMs({ start: 0, end: null }, { start: 10, end: 12 }, 25)).toBe(2);
  });

  it('nunca es negativo, ni con tramos invertidos por un salto del reloj', () => {
    expect(overlapMs({ start: 10, end: 5 }, { start: 0, end: 20 }, 100)).toBe(0);
    expect(overlapMs({ start: 0, end: null }, { start: 10, end: null }, 3)).toBe(0);
  });
});

describe('matchClockMs y periodClockMs', () => {
  const segments = [seg(1, 0, 10 * MINUTE), seg(1, 12 * MINUTE, 25 * MINUTE), seg(2, 35 * MINUTE, null)];

  it('suma los segmentos cerrados y el abierto hasta now', () => {
    expect(matchClockMs(segments, at(50 * MINUTE))).toBe(38 * MINUTE);
    expect(matchClockMs(segments, at(30 * MINUTE))).toBe(23 * MINUTE);
  });

  it('separa por periodo', () => {
    expect(periodClockMs(segments, 1, at(50 * MINUTE))).toBe(23 * MINUTE);
    expect(periodClockMs(segments, 2, at(50 * MINUTE))).toBe(15 * MINUTE);
    expect(periodClockMs(segments, 3, at(50 * MINUTE))).toBe(0);
  });

  it('un segmento abierto con now anterior a su inicio vale 0', () => {
    expect(matchClockMs([seg(1, 10 * MINUTE, null)], at(5 * MINUTE))).toBe(0);
    expect(matchClockMs([], at(0))).toBe(0);
  });
});

describe('playedMs', () => {
  it('la pausa congela a los jugadores sin tocar sus intervalos', () => {
    const segments = [seg(1, 0, 10 * MINUTE), seg(1, 12 * MINUTE, null)];
    const lucas = [iv('lucas', 0, null)];
    expect(playedMs(lucas, segments, at(11 * MINUTE))).toBe(10 * MINUTE);
    expect(playedMs(lucas, segments, at(12 * MINUTE))).toBe(10 * MINUTE);
    expect(playedMs(lucas, segments, at(20 * MINUTE))).toBe(18 * MINUTE);
  });

  it('el descanso congela y un cambio en el descanso no suma hasta la 2ª parte', () => {
    const segments = [seg(1, 0, 25 * MINUTE), seg(2, 35 * MINUTE, null)];
    const lucas = [iv('lucas', 0, 30 * MINUTE)];
    const hugo = [iv('hugo', 30 * MINUTE, null)];
    expect(playedMs(lucas, segments, at(34 * MINUTE))).toBe(25 * MINUTE);
    expect(playedMs(hugo, segments, at(34 * MINUTE))).toBe(0);
    expect(playedMs(hugo, segments, at(45 * MINUTE))).toBe(10 * MINUTE);
    expect(playedMs(lucas, segments, at(45 * MINUTE))).toBe(25 * MINUTE);
  });

  it('el tiempo añadido cuenta: el reloj manda, no la duración del periodo', () => {
    const segments = [seg(1, 0, 27 * MINUTE)];
    const played = playedMs([iv('lucas', 0, null)], segments, at(40 * MINUTE));
    expect(played).toBe(27 * MINUTE);
    expect(playedShare(played, matchClockMs(segments, at(40 * MINUTE)))).toBe(1);
  });

  it('suma N intervalos de un jugador que entra y sale cinco veces', () => {
    const segments = [seg(1, 0, 30 * MINUTE)];
    const intervals = [0, 1, 2, 3, 4].map((i) => iv('hugo', i * 5 * MINUTE, i * 5 * MINUTE + 2 * MINUTE));
    expect(playedMs(intervals, segments, at(30 * MINUTE))).toBe(10 * MINUTE);
  });

  it('playerPlayedMs filtra los intervalos del jugador', () => {
    const state = {
      ...createInitialState(f7Config()),
      clockSegments: [seg(1, 0, null)],
      intervals: [iv('lucas', 0, null), iv('hugo', 5 * MINUTE, null)],
    };
    expect(playerPlayedMs(state, 'lucas', at(10 * MINUTE))).toBe(10 * MINUTE);
    expect(playerPlayedMs(state, 'hugo', at(10 * MINUTE))).toBe(5 * MINUTE);
    expect(playerPlayedMs(state, 'mateo', at(10 * MINUTE))).toBe(0);
  });
});

describe('toMatchTimeMs y fromMatchTimeMs', () => {
  // 1ª parte 0–10' | pausa 2' | 10'–23' | descanso | 2ª parte desde el 35' real, abierta
  const segments = [seg(1, 0, 10 * MINUTE), seg(1, 12 * MINUTE, 25 * MINUTE), seg(2, 35 * MINUTE, null)];
  const now = at(50 * MINUTE);
  const total = 38 * MINUTE;

  it('toMatchTimeMs solo cuenta el reloj transcurrido hasta ese instante', () => {
    expect(toMatchTimeMs(segments, at(-5 * MINUTE))).toBe(0);
    expect(toMatchTimeMs(segments, at(0))).toBe(0);
    expect(toMatchTimeMs(segments, at(5 * MINUTE))).toBe(5 * MINUTE);
    expect(toMatchTimeMs(segments, at(11 * MINUTE))).toBe(10 * MINUTE);
    expect(toMatchTimeMs(segments, at(12 * MINUTE))).toBe(10 * MINUTE);
    expect(toMatchTimeMs(segments, at(20 * MINUTE))).toBe(18 * MINUTE);
    expect(toMatchTimeMs(segments, at(30 * MINUTE))).toBe(23 * MINUTE);
    expect(toMatchTimeMs(segments, at(40 * MINUTE))).toBe(28 * MINUTE);
  });

  it('ida y vuelta real → partido → real dentro de un segmento en marcha', () => {
    for (const offset of [3 * MINUTE, 15 * MINUTE, 40 * MINUTE, 49 * MINUTE + 59 * SECOND]) {
      const ts = at(offset);
      expect(fromMatchTimeMs(segments, toMatchTimeMs(segments, ts), now)).toBe(ts);
    }
  });

  it('ida y vuelta partido → real → partido para todo el reloj disponible', () => {
    for (let m = 0; m <= total; m += 30 * SECOND) {
      const ts = fromMatchTimeMs(segments, m, now);
      expect(ts).not.toBeNull();
      expect(toMatchTimeMs(segments, ts as number)).toBe(m);
    }
  });

  it('en una frontera devuelve el instante en que se paró el reloj', () => {
    expect(fromMatchTimeMs(segments, 10 * MINUTE, now)).toBe(at(10 * MINUTE));
    expect(fromMatchTimeMs(segments, 23 * MINUTE, now)).toBe(at(25 * MINUTE));
    expect(fromMatchTimeMs(segments, total, now)).toBe(now);
  });

  it('devuelve null más allá del reloj disponible o sin segmentos', () => {
    expect(fromMatchTimeMs(segments, total + 1, now)).toBeNull();
    expect(fromMatchTimeMs([], 0, now)).toBeNull();
    expect(fromMatchTimeMs(segments, -5, now)).toBe(at(0));
  });
});


describe('playedShare', () => {
  it('es 0 sin reloj y se acota a 0..1', () => {
    expect(playedShare(5 * MINUTE, 0)).toBe(0);
    expect(playedShare(5 * MINUTE, 10 * MINUTE)).toBe(0.5);
    expect(playedShare(15 * MINUTE, 10 * MINUTE)).toBe(1);
    expect(playedShare(-1, 10 * MINUTE)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formatea mm:ss sin tope de minutos', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(12 * MINUTE + 30 * SECOND)).toBe('12:30');
    expect(formatClock(20 * MINUTE + 45 * SECOND)).toBe('20:45');
    expect(formatClock(125 * MINUTE + 7 * SECOND)).toBe('125:07');
  });

  it('trunca al segundo y nunca es negativo', () => {
    expect(formatClock(59_999)).toBe('00:59');
    expect(formatClock(-5000)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });
});
