import type { AppEventMap } from '../../events/topics';
import { checkInvariants, formatClock, type LineupEntry } from '../../core';
import { MINUTE, SECOND, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { createInMemoryEventStore } from '../../db';
import { createEventBus } from '../../events/bus';
import { createMatchEngine } from '../matchEngine';

/**
 * Revisión de la dimensión "cálculo de tiempos" en la fachada: casos límite de
 * docs/03 §3.6 que los tests del motor no cubrían. Todos pasan: quedan como
 * red de seguridad de la cola serie, del deshacer de eventos de reloj y de la
 * suspensión desde pausa.
 */

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const lineup = (ids: readonly string[]): LineupEntry[] =>
  ids.map((playerId, i) => ({ playerId, position: pos(i), goalkeeper: playerId === 'lucas' }));

function setup() {
  let t = T0;
  const clock = { now: () => t, set: (ms: number) => void (t = ms) };
  let n = 0;
  const store = createInMemoryEventStore();
  const engine = createMatchEngine({
    config: f7Config(),
    store,
    bus: createEventBus<AppEventMap>(),
    now: clock.now,
    newId: () => `evt-${String(++n).padStart(3, '0')}`,
  });
  return { engine, store, clock };
}

async function kickoff() {
  const s = setup();
  await s.engine.load();
  await s.engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
  s.clock.set(T0);
  await s.engine.start();
  return s;
}

describe('revisión: 12:30 + 8:15 = 20:45 a través del motor, con pausa dentro del segundo tramo', () => {
  it('suma exactamente 20:45 y el reloj descuenta la pausa', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 12 * MINUTE + 30 * SECOND);
    await engine.substitute('hugo', 'lucas');
    clock.set(T0 + 16 * MINUTE);
    await engine.substitute('lucas', 'hugo');
    clock.set(T0 + 18 * MINUTE);
    await engine.pause();
    clock.set(T0 + 20 * MINUTE);
    await engine.resume();
    const now = T0 + 26 * MINUTE + 15 * SECOND;
    expect(formatClock(engine.playedMs('lucas', now))).toBe('20:45');
    expect(formatClock(engine.playedMs('hugo', now))).toBe('03:30');
    expect(formatClock(engine.clockMs(now))).toBe('24:15');
  });
});

describe('revisión: deshacer eventos de reloj recalcula y persiste los derivados posteriores', () => {
  it('anular HALFTIME_STARTED: el reloj vuelve a correr y el evento de cámara posterior cambia de minuto', async () => {
    const { engine, store, clock } = await kickoff();
    clock.set(T0 + 27 * MINUTE);
    await engine.startHalftime();
    const camera = await engine.recordExternalEvent({
      type: 'CAMERA_RECORDING_STARTED',
      timestamp: T0 + 30 * MINUTE,
      source: 'camera',
      metadata: { recordingId: 'rec', deviceType: 'dummy' },
    });
    expect(camera).toMatchObject({ matchTimeMs: 27 * MINUTE, period: 1 });

    clock.set(T0 + 31 * MINUTE);
    const updateDerived = jest.spyOn(store, 'updateDerived');
    expect((await engine.undo())?.type).toBe('HALFTIME_STARTED');

    expect(engine.getState().status).toBe('RUNNING');
    expect(engine.clockMs(T0 + 31 * MINUTE)).toBe(31 * MINUTE);
    expect(engine.playedMs('lucas', T0 + 31 * MINUTE)).toBe(31 * MINUTE);
    expect(updateDerived).toHaveBeenCalledWith(f7Config().matchId, [{ id: camera.id, matchTimeMs: 30 * MINUTE, period: 1 }]);
    const stored = await store.loadEvents(f7Config().matchId);
    expect(stored.find((e) => e.id === camera.id)).toMatchObject({ matchTimeMs: 30 * MINUTE, period: 1 });
    expect(engine.getEvents()).toEqual(stored);
  });

  it('anular PERIOD_STARTED: vuelve a HALFTIME, periodo 1, y el gol posterior pasa a 25:00 / periodo 1', async () => {
    const { engine, store, clock } = await kickoff();
    clock.set(T0 + 25 * MINUTE);
    await engine.startHalftime();
    clock.set(T0 + 35 * MINUTE);
    await engine.startNextPeriod();
    // Gol de cámara (no de usuario) para que no sea él el objetivo del deshacer.
    const goal = await engine.recordExternalEvent({ type: 'GOAL', timestamp: T0 + 40 * MINUTE, playerId: 'leo', source: 'camera', metadata: {} });
    expect(goal).toMatchObject({ matchTimeMs: 30 * MINUTE, period: 2 });

    clock.set(T0 + 41 * MINUTE);
    expect((await engine.undo())?.type).toBe('PERIOD_STARTED');
    expect(engine.getState()).toMatchObject({ status: 'HALFTIME', currentPeriod: 1 });
    expect(engine.clockMs(T0 + 41 * MINUTE)).toBe(25 * MINUTE);
    expect(engine.playedMs('lucas', T0 + 41 * MINUTE)).toBe(25 * MINUTE);
    const stored = await store.loadEvents(f7Config().matchId);
    expect(stored.find((e) => e.id === goal.id)).toMatchObject({ matchTimeMs: 25 * MINUTE, period: 1 });
    expect(stored.at(-1)).toMatchObject({ type: 'EVENT_UNDONE', matchTimeMs: 25 * MINUTE, period: 1 });
    expect(checkInvariants(engine.getState())).toEqual([]);
  });
});

describe('revisión: dos cambios casi simultáneos con `at` en orden inverso al de la cola', () => {
  it('se aplican por seq, cada uno con su propio instante, sin minutos negativos', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 5 * MINUTE);
    // El gesto B se soltó 200 ms ANTES que el A, pero su comando llegó después.
    const a = engine.substitute('hugo', 'leo', undefined, T0 + 5 * MINUTE);
    const b = engine.substitute('adrian', 'pablo', undefined, T0 + 5 * MINUTE - 200);
    const [subA, subB] = await Promise.all([a, b]);
    expect([subA.seq, subB.seq]).toEqual([3, 4]);
    expect(subA.matchTimeMs).toBe(5 * MINUTE);
    expect(subB.matchTimeMs).toBe(5 * MINUTE - 200);
    const now = T0 + 8 * MINUTE;
    expect(engine.playedMs('leo', now)).toBe(5 * MINUTE);
    expect(engine.playedMs('hugo', now)).toBe(3 * MINUTE);
    expect(engine.playedMs('pablo', now)).toBe(5 * MINUTE - 200);
    expect(engine.playedMs('adrian', now)).toBe(3 * MINUTE + 200);
    expect(checkInvariants(engine.getState())).toEqual([]);
  });
});

describe('revisión: suspendido desde PAUSED y jugador que llega tarde en el descanso', () => {
  it('MATCH_ENDED{SUSPENDED} en pausa: los minutos quedan en la pausa, no en el final', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 10 * MINUTE);
    await engine.pause();
    clock.set(T0 + 15 * MINUTE);
    await engine.end('SUSPENDED');
    const summary = engine.summary(T0 + 60 * MINUTE);
    expect(summary.clockMs).toBe(10 * MINUTE);
    for (const id of FIELD) expect(engine.playedMs(id, T0 + 60 * MINUTE)).toBe(10 * MINUTE);
    expect(engine.getState().intervals.every((i) => i.endedAt === T0 + 15 * MINUTE)).toBe(true);
  });

  it('PLAYER_ADDED en el descanso y entra en el descanso: 0 hasta PERIOD_STARTED', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 25 * MINUTE);
    await engine.startHalftime();
    clock.set(T0 + 28 * MINUTE);
    await engine.addPlayer('nico');
    await engine.substitute('nico', 'marco');
    expect(engine.getState().players.nico).toMatchObject({ addedLate: true, entries: 1, location: 'FIELD' });
    expect(engine.playedMs('nico', T0 + 34 * MINUTE)).toBe(0);
    clock.set(T0 + 35 * MINUTE);
    await engine.startNextPeriod();
    expect(engine.playedMs('nico', T0 + 40 * MINUTE)).toBe(5 * MINUTE);
    expect(engine.playedMs('marco', T0 + 40 * MINUTE)).toBe(25 * MINUTE);
    expect(engine.summary(T0 + 40 * MINUTE).players.at(-1)?.playerId).toBe('nico');
  });
});

describe('revisión: reloj del sistema hacia atrás en el motor', () => {
  it('REANUDAR con timestamp anterior a la PAUSA no produce nada negativo y las invariantes se cumplen', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 10 * MINUTE);
    await engine.pause();
    clock.set(T0 + 8 * MINUTE); // la hora del sistema retrocede 2 min
    const resumed = await engine.resume();
    expect(resumed.matchTimeMs).toBe(8 * MINUTE);
    expect(checkInvariants(engine.getState())).toEqual([]);
    const now = T0 + 9 * MINUTE;
    expect(engine.clockMs(now)).toBeGreaterThanOrEqual(0);
    for (const id of FIELD) expect(engine.playedMs(id, now)).toBeGreaterThanOrEqual(0);
    // Y un deshacer posterior (con now también "atrasado") sigue siendo coherente.
    await engine.undo(T0 + 8 * MINUTE + 30 * SECOND);
    expect(engine.getState().status).toBe('PAUSED');
    expect(engine.getEvents().at(-1)).toMatchObject({ type: 'EVENT_UNDONE', matchTimeMs: 8 * MINUTE + 30 * SECOND, period: 1 });
  });
});
