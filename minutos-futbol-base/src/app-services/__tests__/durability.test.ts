import type { AppEventMap } from '../../events/topics';
import { checkInvariants, deriveEventFields, reduceMatch, type LineupEntry } from '../../core';
import { F7_SQUAD, MINUTE, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { EventStoreError, createInMemoryEventStore, createSqliteEventStore, migrate, type EventStore } from '../../db';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from '../../db/__tests__/nodeSqlite';
import { createEventBus } from '../../events/bus';
import { createMatchEngine } from '../matchEngine';

/**
 * REVISIÓN (durabilidad y recuperación) del MatchEngine sobre el EventStore.
 *
 * Bloques:
 *  1. Escribir antes de mostrar, comprobado contra SQLite REAL: cuando un
 *     suscriptor o el bus reciben el aviso, la fila ya está confirmada.
 *  2. Recuperación a mitad de partido (reloj en marcha, intervalos abiertos)
 *     sobre SQLite real: el segundo motor es idéntico y los minutos siguen
 *     sumando con un `now` posterior.
 *  3. Muerte del proceso dentro de `undo()`: tras `updateDerived` y antes de
 *     EVENT_UNDONE el log queda coherente (solo falta el rastro).
 *  4. Errores del almacén en comandos y en `markVoided`: se propagan como
 *     EventStoreError y no dejan nada a medias.
 *  5. OBSERVACIÓN sobre la cola serie: `undo()` no admite "objetivo esperado".
 *  6. HALLAZGO (falla a propósito): si `updateDerived` falla DESPUÉS de
 *     `markVoided`, memoria y disco divergen y el partido deja de cargar.
 */

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const MATCH_ID = f7Config().matchId;
const lineup = (ids: readonly string[]): LineupEntry[] =>
  ids.map((playerId, i) => ({ playerId, position: pos(i), goalkeeper: playerId === 'lucas' }));

function setup(store: EventStore = createInMemoryEventStore()) {
  let t = T0;
  const clock = { now: () => t, set: (ms: number) => void (t = ms) };
  let n = 0;
  const bus = createEventBus<AppEventMap>();
  const engine = createMatchEngine({
    config: f7Config(),
    store,
    bus,
    now: clock.now,
    newId: () => `evt-${String(++n).padStart(3, '0')}`,
  });
  return { engine, store, bus, clock };
}

/** Alineación a −5:00 y pitido inicial en T0. */
async function kickoff(store?: EventStore) {
  const s = setup(store);
  await s.engine.load();
  await s.engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
  s.clock.set(T0);
  await s.engine.start();
  return s;
}

const secondEngine = (store: EventStore, now: () => number) =>
  createMatchEngine({ config: f7Config(), store, bus: createEventBus<AppEventMap>(), now });

// ───────────────────────── 1 y 2. Sobre SQLite real ─────────────────────────

describeWithSqlite('review-durabilidad: MatchEngine sobre SQLite real', () => {
  let native: NodeSqliteDatabase;
  let store: EventStore;

  const rows = () => (native.prepare('SELECT COUNT(*) AS n FROM match_event WHERE match_id = ?').get(MATCH_ID) as { n: number }).n;
  const voidedOnDisk = (id: string) =>
    (native.prepare('SELECT voided_at FROM match_event WHERE id = ?').get(id) as { voided_at: number | null }).voided_at;

  beforeEach(async () => {
    native = openMemoryDatabase();
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    store = createSqliteEventStore(db, { now: () => T0 });
  });

  afterEach(() => native.close());

  it('escribir antes de mostrar: cuando el suscriptor y el bus reciben cada evento (y el deshacer), la fila ya está en SQLite', async () => {
    const { engine, bus, clock } = setup(store);
    const seen: string[] = [];
    // Cada aviso anota cuántas filas hay YA confirmadas en ese instante.
    engine.subscribe((state) => seen.push(`estado ${state.lastSeq} con ${rows()} filas`));
    bus.on('match.event.recorded', ({ event }) => seen.push(`recorded seq ${event.seq} con ${rows()} filas`));
    bus.on('match.event.undone', ({ event }) => seen.push(`undone anulado en disco: ${voidedOnDisk(event.id) != null}`));

    await engine.load();
    await engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
    clock.set(T0);
    await engine.start();
    clock.set(T0 + 12 * MINUTE);
    await engine.pause();
    clock.set(T0 + 13 * MINUTE);
    await engine.undo();

    expect(seen).toEqual([
      'estado 0 con 0 filas',
      'estado 1 con 1 filas',
      'recorded seq 1 con 1 filas',
      'estado 2 con 2 filas',
      'recorded seq 2 con 2 filas',
      'estado 3 con 3 filas',
      'recorded seq 3 con 3 filas',
      // deshacer: se notifica en cuanto la pausa está anulada en disco (todavía 3 filas),
      // y el rastro EVENT_UNDONE (seq 4) ya está escrito cuando llega su propio aviso.
      'estado 3 con 3 filas',
      'undone anulado en disco: true',
      'estado 4 con 4 filas',
      'recorded seq 4 con 4 filas',
    ]);
  });

  it('recuperación a mitad de partido: reloj en marcha e intervalos abiertos, el segundo motor es idéntico y los minutos siguen sumando', async () => {
    const s = await kickoff(store);
    s.clock.set(T0 + 10 * MINUTE);
    await s.engine.substitute('hugo', 'lucas');
    s.clock.set(T0 + 12 * MINUTE);
    await s.engine.pause();
    s.clock.set(T0 + 14 * MINUTE);
    await s.engine.resume();
    s.clock.set(T0 + 16 * MINUTE);
    await s.engine.leavePlayer('marco'); // quedan 6 en el campo, intervalo de Marco cerrado

    // "Muere el proceso": el primer motor no vuelve a usarse. Se abre otro sobre el mismo archivo.
    const second = secondEngine(store, s.clock.now);
    const loaded = await second.load();

    expect(loaded).toEqual(s.engine.getState());
    expect(loaded.status).toBe('RUNNING');
    expect(loaded.clockSegments.filter((c) => c.endedAt == null)).toHaveLength(1);
    expect(
      loaded.intervals
        .filter((i) => i.endedAt == null)
        .map((i) => i.playerId)
        .sort(),
    ).toEqual(['alex', 'daniel', 'hugo', 'leo', 'mateo', 'pablo']);
    expect(checkInvariants(loaded)).toEqual([]);

    // El móvil estuvo bloqueado 14 minutos: solo hace falta un `now` fresco.
    const later = T0 + 30 * MINUTE;
    expect(second.clockMs(later)).toBe(28 * MINUTE); // 12 + 16
    expect(second.playedMs('hugo', later)).toBe(18 * MINUTE); // 10→12 y 14→30
    expect(second.playedMs('lucas', later)).toBe(10 * MINUTE);
    expect(second.playedMs('marco', later)).toBe(14 * MINUTE); // 0→12 y 14→16
    expect(second.playedMs('leo', later)).toBe(28 * MINUTE);
    for (const id of F7_SQUAD) expect(second.playedMs(id, later)).toBe(s.engine.playedMs(id, later));

    // Y continúa el partido donde estaba, sin huecos en seq.
    const entered = await second.enterPlayer('david', pos(6), later);
    expect(entered.seq).toBe(7);
    expect(second.playedMs('david', later + 5 * MINUTE)).toBe(5 * MINUTE);
    expect(checkInvariants(second.getState())).toEqual([]);
  });
});

// ───────────────────────── 3. Muerte dentro de undo() ─────────────────────────

describe('review-durabilidad: muerte del proceso dentro de undo()', () => {
  it('tras updateDerived y antes de EVENT_UNDONE: el log recargado es coherente (estado, derivados, pila) y solo falta el rastro', async () => {
    const s = await kickoff();
    s.clock.set(T0 + 12 * MINUTE);
    const pause = await s.engine.pause();
    const camera = await s.engine.recordExternalEvent({
      type: 'CAMERA_RECORDING_STARTED',
      timestamp: T0 + 13 * MINUTE,
      source: 'camera',
      metadata: { recordingId: 'rec-1', deviceType: 'dummy' },
    });
    expect(camera.matchTimeMs).toBe(12 * MINUTE);

    // Pasos 1-3 de undo() tal cual los hace el motor; el proceso muere antes del 4.
    await s.store.markVoided(MATCH_ID, pause.id, T0 + 14 * MINUTE);
    await s.store.updateDerived(MATCH_ID, [{ id: camera.id, matchTimeMs: 13 * MINUTE, period: 1 }]);

    const second = secondEngine(s.store, s.clock.now);
    await second.load();
    expect(second.getState().status).toBe('RUNNING');
    expect(checkInvariants(second.getState())).toEqual([]);
    // Derivados en disco == recomputados: no hay nada obsoleto.
    expect(deriveEventFields(second.getEvents())).toStrictEqual([...second.getEvents()]);
    expect(second.clockMs(T0 + 20 * MINUTE)).toBe(20 * MINUTE);
    expect(second.playedMs('lucas', T0 + 20 * MINUTE)).toBe(20 * MINUTE);
    // La pila de deshacer ya no ofrece la pausa anulada.
    expect(second.peekUndo()?.type).toBe('MATCH_STARTED');
    expect(second.getEvents().some((e) => e.type === 'EVENT_UNDONE')).toBe(false);

    // El siguiente deshacer funciona y su seq continúa el del log (sin huecos ni duplicados).
    const undone = await second.undo(T0 + 21 * MINUTE);
    expect(undone?.type).toBe('MATCH_STARTED');
    expect(second.getState().status).toBe('READY');
    expect(second.getEvents().at(-1)).toMatchObject({ type: 'EVENT_UNDONE', seq: 5, metadata: { targetEventId: undone?.id } });
    expect(await s.store.loadEvents(MATCH_ID)).toStrictEqual([...second.getEvents()]);
  });
});

// ───────────────────────── 4. Errores del almacén ─────────────────────────

describe('review-durabilidad: errores del almacén', () => {
  it('un append que falla en un comando se propaga como EventStoreError y no deja nada a medias: estado, eventos, pila, suscriptores ni bus', async () => {
    const s = await kickoff();
    const before = s.engine.getState();
    const eventsBefore = s.engine.getEvents();
    const listener = jest.fn();
    s.engine.subscribe(listener);
    const published: string[] = [];
    s.bus.on('match.event.recorded', ({ event }) => published.push(event.type));
    s.bus.on('match.paused', () => published.push('match.paused'));

    const realAppend = s.store.append;
    s.store.append = async () => {
      throw new EventStoreError('STORAGE', 'append: disk I/O error');
    };
    s.clock.set(T0 + 5 * MINUTE);
    const error: unknown = await s.engine.pause().catch((e: unknown) => e);
    s.store.append = realAppend;

    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('STORAGE');
    expect(s.engine.getState()).toBe(before);
    expect(s.engine.getEvents()).toBe(eventsBefore);
    expect(s.engine.peekUndo()?.type).toBe('MATCH_STARTED');
    expect(listener).not.toHaveBeenCalled();
    expect(published).toEqual([]);
    expect(await s.store.loadEvents(MATCH_ID)).toHaveLength(2);

    // Reintentar funciona y reutiliza el seq que no llegó a escribirse.
    const paused = await s.engine.pause();
    expect(paused.seq).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(published).toEqual(['match.paused', 'MATCH_PAUSED']);
  });

  it('un markVoided que falla deja el deshacer sin efecto alguno y la pila intacta', async () => {
    const s = await kickoff();
    s.clock.set(T0 + 10 * MINUTE);
    const sub = await s.engine.substitute('hugo', 'lucas');
    const before = s.engine.getState();
    const listener = jest.fn();
    s.engine.subscribe(listener);

    const realMarkVoided = s.store.markVoided;
    s.store.markVoided = async () => {
      throw new EventStoreError('STORAGE', 'markVoided: database is locked');
    };
    const error: unknown = await s.engine.undo(T0 + 11 * MINUTE).catch((e: unknown) => e);
    s.store.markVoided = realMarkVoided;

    expect((error as EventStoreError).code).toBe('STORAGE');
    expect(s.engine.getState()).toBe(before);
    expect(s.engine.peekUndo()?.id).toBe(sub.id);
    expect(listener).not.toHaveBeenCalled();
    expect((await s.store.loadEvents(MATCH_ID)).find((e) => e.id === sub.id)?.voidedAt).toBeNull();
    // Reintentar deshace exactamente lo que se pretendía.
    expect((await s.engine.undo(T0 + 11 * MINUTE))?.id).toBe(sub.id);
  });
});

// ───────────────────────── 5. Cola serie ─────────────────────────

describe('cola serie y deshacer', () => {
  it('undo(expectedTargetId) rechaza si entre tanto entró otro gesto: nunca se deshace algo distinto de lo que mostraba el botón', async () => {
    const s = await kickoff();
    s.clock.set(T0 + 10 * MINUTE);
    // Lo que el botón DESHACER está mostrando ("↶ INICIO").
    const shown = s.engine.peekUndo();
    expect(shown?.type).toBe('MATCH_STARTED');
    // Un gesto de cambio que acaba de soltarse y aún no ha confirmado...
    const inFlight = s.engine.substitute('hugo', 'lucas');
    // ...y la pulsación de DESHACER que llega detrás, con el botón todavía en "↶ INICIO".
    const attempt = s.engine.undo(undefined, shown?.id);
    const sub = await inFlight;

    await expect(attempt).rejects.toMatchObject({ name: 'MatchRuleError', code: 'INVALID_EVENT' });
    // Nada se anuló: la sustitución sigue vigente y disco == memoria.
    expect((await s.store.loadEvents(MATCH_ID)).every((e) => e.voidedAt === null)).toBe(true);
    expect(s.engine.peekUndo()?.id).toBe(sub.id);
    expect(checkInvariants(s.engine.getState())).toEqual([]);
    // Sin objetivo esperado se deshace lo último, que ahora sí es la sustitución.
    const undone = await s.engine.undo();
    expect(undone?.id).toBe(sub.id);
    expect(s.engine.getState().status).toBe('RUNNING');
  });

  it('si updateDerived falla tras markVoided, el deshacer ya es un hecho: memoria == disco, se avisa y el partido vuelve a cargar', async () => {
    const s = await kickoff();
    s.clock.set(T0 + 12 * MINUTE);
    const pause = await s.engine.pause();
    // Un evento posterior cuyo minuto cambia al anular la pausa: obliga a llamar a updateDerived.
    const camera = await s.engine.recordExternalEvent({
      type: 'CAMERA_RECORDING_STARTED',
      timestamp: T0 + 13 * MINUTE,
      source: 'camera',
      metadata: { recordingId: 'rec-1', deviceType: 'dummy' },
    });
    const listener = jest.fn();
    s.engine.subscribe(listener);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const realUpdateDerived = s.store.updateDerived;
    s.store.updateDerived = async () => {
      throw new EventStoreError('STORAGE', 'updateDerived: disk I/O error');
    };
    s.clock.set(T0 + 14 * MINUTE);
    const undone = await s.engine.undo();
    s.store.updateDerived = realUpdateDerived;

    expect(undone?.id).toBe(pause.id);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    // En disco la pausa está anulada y la memoria dice lo mismo que el disco (y avisó).
    const stored = await s.store.loadEvents(MATCH_ID);
    expect(stored.find((e) => e.id === pause.id)?.voidedAt).toBe(T0 + 14 * MINUTE);
    expect(s.engine.getState().status).toBe(reduceMatch(f7Config(), stored).status);
    expect(s.engine.getState().status).toBe('RUNNING');
    expect(listener).toHaveBeenCalled();
    // Los derivados no se pudieron reescribir: la memoria conserva los del disco (12:00), no miente.
    expect(s.engine.getEvents().find((e) => e.id === camera.id)?.matchTimeMs).toBe(12 * MINUTE);

    // El siguiente comando es válido y, al reabrir, load() repara los derivados.
    s.clock.set(T0 + 15 * MINUTE);
    await s.engine.pause();
    const second = secondEngine(s.store, s.clock.now);
    await second.load();
    expect(second.getState().status).toBe('PAUSED');
    expect(second.getEvents().find((e) => e.id === camera.id)?.matchTimeMs).toBe(13 * MINUTE);
    expect((await s.store.loadEvents(MATCH_ID)).find((e) => e.id === camera.id)?.matchTimeMs).toBe(13 * MINUTE);
  });
});
