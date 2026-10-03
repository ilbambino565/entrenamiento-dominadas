import type { MatchEvent } from '../events';
import { changedDerivedFields, deriveEventFields } from '../derive';
import { EventFactory, MINUTE, STARTERS, T0, voided } from './helpers';

const byId = (events: readonly MatchEvent[]) => new Map(events.map((e) => [e.id, e]));

/**
 * Partido con de todo: alineación previa, pausa, tiempo añadido, descanso con
 * un evento de cámara, 2ª parte y final.
 */
function scenario() {
  const ev = new EventFactory();
  const e = {
    lineup: ev.lineup(T0 - 10 * MINUTE, STARTERS),
    start: ev.start(T0),
    subA: ev.sub(T0 + 5 * MINUTE, 'marco', 'lucas'),
    pause: ev.pause(T0 + 10 * MINUTE),
    goalInPause: ev.goal(T0 + 12 * MINUTE, 'hugo'),
    resume: ev.resume(T0 + 13 * MINUTE),
    subB: ev.sub(T0 + 20 * MINUTE, 'adrian', 'hugo'),
    halftime: ev.halftime(T0 + 30 * MINUTE),
    camera: ev.cameraStarted(T0 + 35 * MINUTE),
    second: ev.nextPeriod(T0 + 45 * MINUTE),
    subC: ev.sub(T0 + 50 * MINUTE, 'david', 'mateo'),
    end: ev.end(T0 + 72 * MINUTE),
  };
  return { ev, e, events: Object.values(e) as MatchEvent[] };
}

describe('deriveEventFields', () => {
  it('calcula matchTimeMs y period en 1ª parte, pausa, tiempo añadido, descanso y 2ª parte', () => {
    const { e, events } = scenario();
    const derived = byId(deriveEventFields(events));
    const expectFields = (event: MatchEvent, matchTimeMs: number, period: number) =>
      expect(derived.get(event.id)).toMatchObject({ matchTimeMs, period });

    expectFields(e.lineup, 0, 0);
    expectFields(e.start, 0, 1);
    expectFields(e.subA, 5 * MINUTE, 1);
    expectFields(e.pause, 10 * MINUTE, 1);
    expectFields(e.goalInPause, 10 * MINUTE, 1);
    expectFields(e.resume, 10 * MINUTE, 1);
    expectFields(e.subB, 17 * MINUTE, 1);
    // 10' + 17' = 27': dos minutos de tiempo añadido en la 1ª parte.
    expectFields(e.halftime, 27 * MINUTE, 1);
    // Evento de cámara en el descanso: lo jugado en la 1ª parte y sigue siendo periodo 1.
    expectFields(e.camera, 27 * MINUTE, 1);
    expectFields(e.second, 27 * MINUTE, 2);
    expectFields(e.subC, 32 * MINUTE, 2);
    expectFields(e.end, 54 * MINUTE, 2);
  });

  it('devuelve copias de TODOS los eventos ordenadas por seq, sin tocar el timestamp', () => {
    const { events } = scenario();
    const shuffled = [...events].reverse();
    const derived = deriveEventFields(shuffled);
    expect(derived).toHaveLength(events.length);
    expect(derived.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
    expect(derived.map((e) => e.timestamp)).toEqual(events.map((e) => e.timestamp));
    derived.forEach((d, i) => expect(d).not.toBe(shuffled[events.length - 1 - i]));
    expect(shuffled.every((e) => e.matchTimeMs === 0 && e.period === 0)).toBe(true);
  });

  it('incluye los anulados y los de sistema, pero solo el reloj válido cuenta', () => {
    const { e, events } = scenario();
    const ev = new EventFactory();
    // Se deshace después del final: su minuto es el del reloj completo.
    const undone = { ...ev.undone(T0 + 73 * MINUTE, e.subB.id), seq: 100 };
    const derived = byId(deriveEventFields(events.map((x) => (x === e.subB ? voided(x, undone.timestamp) : x)).concat(undone)));
    expect(derived.get(e.subB.id)).toMatchObject({ matchTimeMs: 17 * MINUTE, period: 1, voidedAt: undone.timestamp });
    expect(derived.get(undone.id)).toMatchObject({ matchTimeMs: 54 * MINUTE, period: 2 });
  });

  it('al anular un MATCH_PAUSED los matchTimeMs posteriores cambian', () => {
    const ev = new EventFactory();
    const start = ev.start(T0);
    const pause = ev.pause(T0 + 10 * MINUTE);
    const sub = ev.sub(T0 + 12 * MINUTE, 'marco', 'lucas');
    const camera = ev.cameraStarted(T0 + 15 * MINUTE);
    const before = deriveEventFields([start, pause, sub, camera]);
    expect(byId(before).get(sub.id)?.matchTimeMs).toBe(10 * MINUTE);
    expect(byId(before).get(camera.id)?.matchTimeMs).toBe(10 * MINUTE);

    const after = deriveEventFields([start, voided(pause), sub, camera]);
    expect(byId(after).get(pause.id)).toMatchObject({ matchTimeMs: 10 * MINUTE, period: 1 });
    expect(byId(after).get(sub.id)?.matchTimeMs).toBe(12 * MINUTE);
    expect(byId(after).get(camera.id)?.matchTimeMs).toBe(15 * MINUTE);

    expect(changedDerivedFields(before, after)).toEqual([
      { id: sub.id, matchTimeMs: 12 * MINUTE, period: 1 },
      { id: camera.id, matchTimeMs: 15 * MINUTE, period: 1 },
    ]);
  });

  it('un evento anterior al pitido inicial queda en 0 / periodo 0 aunque el reloj corra después', () => {
    const ev = new EventFactory();
    const derived = deriveEventFields([ev.goal(T0 - MINUTE, 'lucas'), ev.lineup(T0, STARTERS), ev.start(T0 + MINUTE)]);
    expect(derived.slice(0, 2).every((e) => e.matchTimeMs === 0 && e.period === 0)).toBe(true);
  });
});

describe('changedDerivedFields', () => {
  it('es vacío cuando nada cambia e incluye ids nuevos', () => {
    const { events } = scenario();
    const derived = deriveEventFields(events);
    expect(changedDerivedFields(derived, derived)).toEqual([]);
    const extra = { ...new EventFactory().cameraStarted(T0 + 60 * MINUTE), seq: 99 };
    const withExtra = deriveEventFields([...events, extra]);
    expect(changedDerivedFields(derived, withExtra)).toEqual([{ id: extra.id, matchTimeMs: 42 * MINUTE, period: 2 }]);
  });
});
