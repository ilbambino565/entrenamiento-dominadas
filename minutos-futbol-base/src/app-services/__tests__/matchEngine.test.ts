import {
  MatchRuleError,
  checkInvariants,
  type LineupEntry,
  type MatchEvent,
  type MatchEventType,
  type MatchRuleErrorCode,
} from '../../core';
import { F7_SQUAD, MINUTE, SECOND, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { createInMemoryEventStore, createSqliteEventStore, migrate, type EventStore } from '../../db';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase } from '../../db/__tests__/nodeSqlite';
import { createEventBus } from '../../events/bus';
import { createMatchEngine, type AppBusEventMap, type MatchEngine } from '../matchEngine';

/**
 * Partido F7 de referencia (tiempos relativos a T0 = pitido inicial):
 *
 *   -5:00  alineación      0:00 inicio      10:00 Hugo entra por Lucas
 *   12:00  pausa           14:00 reanudar   27:00 descanso (reloj 25:00)
 *   30:00  Adrián por Mateo (en el descanso)  37:00 2ª parte
 *   65:00  final (2ª parte de 28 min: 25 + 3 de añadido)  → reloj 53:00
 */
const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;

const lineup = (ids: readonly string[]): LineupEntry[] =>
  ids.map((playerId, i) => ({ playerId, position: pos(i), goalkeeper: playerId === 'lucas' }));

const ALL_TOPICS = [
  'match.started',
  'match.paused',
  'match.resumed',
  'match.halftime',
  'match.period.started',
  'match.finished',
  'player.entered',
  'player.left',
  'player.substituted',
  'match.event.recorded',
  'match.event.undone',
] as const;

interface Published {
  topic: (typeof ALL_TOPICS)[number];
  payload: unknown;
}

function setup(store: EventStore = createInMemoryEventStore()) {
  let t = T0;
  const clock = {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
  };
  let n = 0;
  const newId = () => `evt-${String(++n).padStart(3, '0')}`;
  const bus = createEventBus<AppBusEventMap>();
  const published: Published[] = [];
  for (const topic of ALL_TOPICS) bus.on(topic, (payload) => published.push({ topic, payload }));
  const engine = createMatchEngine({ config: f7Config(), store, bus, now: clock.now, newId });
  return { engine, store, bus, clock, published, topics: () => published.map((p) => p.topic) };
}

/** Ejecuta el partido de referencia completo. */
async function playReferenceMatch(engine: MatchEngine, clock: { set: (ms: number) => void }) {
  await engine.load();
  await engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
  clock.set(T0);
  await engine.start();
  clock.set(T0 + 10 * MINUTE);
  await engine.substitute('hugo', 'lucas');
  clock.set(T0 + 12 * MINUTE);
  await engine.pause();
  clock.set(T0 + 14 * MINUTE);
  await engine.resume();
  clock.set(T0 + 27 * MINUTE);
  await engine.startHalftime();
  clock.set(T0 + 30 * MINUTE);
  await engine.substitute('adrian', 'mateo');
  clock.set(T0 + 37 * MINUTE);
  await engine.startNextPeriod();
  clock.set(T0 + 65 * MINUTE);
  await engine.end();
}

const EXPECTED_PLAYED_MIN: Record<string, number> = {
  lucas: 10,
  hugo: 43,
  mateo: 25,
  adrian: 28,
  leo: 53,
  daniel: 53,
  pablo: 53,
  alex: 53,
  marco: 53,
  david: 0,
};

async function ruleCode(promise: Promise<unknown>): Promise<MatchRuleErrorCode | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof MatchRuleError) return error.code;
    throw error;
  }
}

describe('createMatchEngine', () => {
  describe('flujo completo F7', () => {
    it('calcula los minutos de cada implicado al segundo, el porcentaje y el resumen', async () => {
      const { engine, clock } = setup();
      await playReferenceMatch(engine, clock);
      // Tras el final, el reloj está parado: `now` posterior no cambia nada.
      const later = T0 + 70 * MINUTE;

      expect(engine.getState().status).toBe('FINISHED');
      expect(engine.getState().endReason).toBe('NORMAL');
      expect(checkInvariants(engine.getState())).toEqual([]);
      expect(engine.clockMs(later)).toBe(53 * MINUTE);
      for (const [playerId, minutes] of Object.entries(EXPECTED_PLAYED_MIN)) {
        expect(engine.playedMs(playerId, later)).toBe(minutes * MINUTE);
      }

      const summary = engine.summary(later);
      expect(summary.clockMs).toBe(53 * MINUTE);
      expect(summary.players.map((p) => p.playerId)).toEqual([...F7_SQUAD]);
      const byId = Object.fromEntries(summary.players.map((p) => [p.playerId, p]));
      expect(byId.lucas?.share).toBeCloseTo(10 / 53, 6);
      expect(byId.hugo?.share).toBeCloseTo(43 / 53, 6);
      expect(byId.hugo).toMatchObject({ entries: 1, wasStarter: false, onFieldNow: true });
      expect(byId.lucas).toMatchObject({ entries: 0, wasStarter: true, onFieldNow: false });
      expect(byId.david).toMatchObject({ playedMs: 0, share: 0, onFieldNow: false });
      expect(summary.maxMs).toBe(53 * MINUTE);
      expect(summary.minMs).toBe(0);
      expect(summary.avgMs).toBe((371 / 10) * MINUTE);
    });

    it('persiste todos los eventos con seq consecutivos, matchTimeMs y period correctos', async () => {
      const { engine, store, clock } = setup();
      await playReferenceMatch(engine, clock);

      const stored = await store.loadEvents(f7Config().matchId);
      expect(stored.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(stored.every((e) => e.source === 'user' && e.voidedAt === null)).toBe(true);
      expect(stored.map((e) => [e.type, e.matchTimeMs / MINUTE, e.period])).toEqual([
        ['LINEUP_SET', 0, 0],
        ['MATCH_STARTED', 0, 1],
        ['SUBSTITUTION', 10, 1],
        ['MATCH_PAUSED', 12, 1],
        ['MATCH_RESUMED', 12, 1],
        ['HALFTIME_STARTED', 25, 1],
        ['SUBSTITUTION', 25, 1], // el cambio del descanso: reloj parado en 25:00, periodo 1
        ['PERIOD_STARTED', 25, 2],
        ['MATCH_ENDED', 53, 2],
      ]);
      // Lo que hay en memoria es exactamente lo persistido.
      expect(engine.getEvents()).toEqual(stored);
      expect(engine.getTimeline()).toEqual(stored);
    });

    it('la sustitución sin posición hereda la del que sale; con jugador fuera del campo es inválida', async () => {
      const { engine, clock } = setup();
      await playReferenceMatch(engine, clock);
      const sub = engine.getEvents()[2] as MatchEvent<'SUBSTITUTION'>;
      expect(sub.playerId).toBe('hugo');
      expect(sub.secondaryPlayerId).toBe('lucas');
      expect(sub.metadata.position).toEqual(pos(0));
      expect(engine.getState().players.hugo?.isGoalkeeper).toBe(true); // hereda la portería de Lucas

      const { engine: fresh, clock: c2 } = setup();
      await fresh.load();
      await fresh.setLineup(lineup(FIELD), [...SUBS]);
      c2.set(T0);
      await fresh.start();
      expect(await ruleCode(fresh.substitute('hugo', 'david'))).toBe('PLAYER_NOT_ON_FIELD');
      expect(fresh.getEvents()).toHaveLength(2);
    });
  });

  describe('deshacer', () => {
    it('una sustitución accidental devuelve exactamente los minutos previos y deja rastro persistido', async () => {
      const { engine, store, clock, topics } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + 10 * MINUTE);
      const accidental = await engine.substitute('hugo', 'lucas');
      expect(engine.canUndo()).toBe(true);
      expect(engine.peekUndo()).toEqual(accidental);

      const undoAt = T0 + 10 * MINUTE + 20 * SECOND;
      clock.set(undoAt);
      const updateDerived = jest.spyOn(store, 'updateDerived');
      const undone = await engine.undo();

      // Como si nunca hubiera ocurrido: Lucas nunca salió, Hugo nunca entró.
      expect(undone).toMatchObject({ id: accidental.id, type: 'SUBSTITUTION', voidedAt: undoAt });
      expect(engine.playedMs('lucas', undoAt)).toBe(10 * MINUTE + 20 * SECOND);
      expect(engine.playedMs('hugo', undoAt)).toBe(0);
      expect(engine.getState().players.lucas).toMatchObject({ location: 'FIELD', isGoalkeeper: true });
      expect(engine.getState().players.hugo).toMatchObject({ location: 'BENCH', entries: 0, isGoalkeeper: false });
      expect(checkInvariants(engine.getState())).toEqual([]);

      const stored = await store.loadEvents(f7Config().matchId);
      expect(stored.map((e) => e.type)).toEqual(['LINEUP_SET', 'MATCH_STARTED', 'SUBSTITUTION', 'EVENT_UNDONE']);
      expect(stored[2]?.voidedAt).toBe(undoAt);
      expect(stored[3]).toMatchObject({
        seq: 4,
        source: 'system',
        timestamp: undoAt,
        matchTimeMs: 10 * MINUTE + 20 * SECOND,
        period: 1,
        metadata: { targetEventId: accidental.id },
      });
      // Anular un cambio no mueve el reloj: no hay campos derivados que reescribir.
      expect(updateDerived).not.toHaveBeenCalled();
      expect(engine.getEvents()).toEqual(stored);
      expect(engine.getTimeline().map((e) => e.type)).toEqual(['LINEUP_SET', 'MATCH_STARTED', 'EVENT_UNDONE']);
      expect(topics().slice(-2)).toEqual(['match.event.undone', 'match.event.recorded']);

      // La pila sigue: inicio → alineación → nada.
      expect(engine.peekUndo()?.type).toBe('MATCH_STARTED');
      expect((await engine.undo())?.type).toBe('MATCH_STARTED');
      expect(engine.getState().status).toBe('READY');
      expect((await engine.undo())?.type).toBe('LINEUP_SET');
      expect(engine.getState().status).toBe('DRAFT');
      expect(engine.canUndo()).toBe(false);
      expect(engine.peekUndo()).toBeNull();
      expect(await engine.undo()).toBeNull();
      expect(checkInvariants(engine.getState())).toEqual([]);
    });

    it('deshacer una pausa recalcula y persiste matchTimeMs/period de los eventos posteriores', async () => {
      const { engine, store, clock } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + 12 * MINUTE);
      await engine.pause();
      // Un evento de cámara posterior (no se deshace: no es de usuario).
      const camera = await engine.recordExternalEvent({
        type: 'CAMERA_RECORDING_STARTED',
        timestamp: T0 + 13 * MINUTE,
        source: 'camera',
        metadata: { recordingId: 'rec-1', deviceType: 'dummy' },
      });
      expect(camera.matchTimeMs).toBe(12 * MINUTE);
      expect(engine.peekUndo()?.type).toBe('MATCH_PAUSED');

      clock.set(T0 + 14 * MINUTE);
      const updateDerived = jest.spyOn(store, 'updateDerived');
      const undone = await engine.undo();
      expect(undone?.type).toBe('MATCH_PAUSED');

      // Sin la pausa el reloj nunca se paró: el evento de cámara pasa a 13:00.
      expect(engine.getState().status).toBe('RUNNING');
      expect(engine.clockMs(T0 + 14 * MINUTE)).toBe(14 * MINUTE);
      expect(updateDerived).toHaveBeenCalledTimes(1);
      expect(updateDerived).toHaveBeenCalledWith(f7Config().matchId, [{ id: camera.id, matchTimeMs: 13 * MINUTE, period: 1 }]);
      const stored = await store.loadEvents(f7Config().matchId);
      expect(stored.find((e) => e.id === camera.id)?.matchTimeMs).toBe(13 * MINUTE);
      expect(stored[stored.length - 1]).toMatchObject({ type: 'EVENT_UNDONE', matchTimeMs: 14 * MINUTE, period: 1 });
      expect(engine.getEvents()).toEqual(stored);
    });
  });

  describe('recuperación', () => {
    it('un segundo motor sobre el mismo almacén regenera un estado idéntico y los mismos minutos', async () => {
      const { engine, store, clock } = setup();
      await playReferenceMatch(engine, clock);
      // Un deshacer de por medio para que haya anulados y campos derivados reescritos.
      clock.set(T0 + 66 * MINUTE);
      await engine.undo(); // anula MATCH_ENDED: el partido vuelve a estar en juego
      expect(engine.getState().status).toBe('RUNNING');

      const second = createMatchEngine({ config: f7Config(), store, bus: createEventBus<AppBusEventMap>(), now: clock.now });
      const loaded = await second.load();

      expect(loaded).toEqual(engine.getState());
      expect(second.getEvents()).toEqual(engine.getEvents());
      const at = T0 + 70 * MINUTE;
      for (const playerId of F7_SQUAD) expect(second.playedMs(playerId, at)).toBe(engine.playedMs(playerId, at));
      expect(second.summary(at)).toEqual(engine.summary(at));
      expect(second.peekUndo()).toEqual(engine.peekUndo());
      // Y puede seguir el partido donde lo dejó el primero.
      const ended = await second.end('NORMAL', at);
      expect(ended.seq).toBe(engine.getState().lastSeq + 1);
    });

    it('load() notifica a los suscriptores y rechaza un log incoherente sin tocar el estado', async () => {
      const { engine, store } = setup();
      const listener = jest.fn();
      engine.subscribe(listener);
      await store.append({
        id: 'bad-1',
        matchId: f7Config().matchId,
        seq: 1,
        type: 'MATCH_PAUSED',
        timestamp: T0,
        matchTimeMs: 0,
        period: 0,
        playerId: null,
        secondaryPlayerId: null,
        metadata: {},
        source: 'user',
        voidedAt: null,
      });
      await expect(engine.load()).rejects.toBeInstanceOf(MatchRuleError);
      expect(listener).not.toHaveBeenCalled();
      expect(engine.getState().status).toBe('DRAFT');
    });

    it('antes de load() los comandos y los eventos externos se rechazan', async () => {
      const { engine } = setup();
      await expect(engine.start()).rejects.toThrow(/load\(\)/);
      await expect(
        engine.recordExternalEvent({ type: 'GOAL', timestamp: T0, playerId: 'lucas', metadata: {} }),
      ).rejects.toThrow(/load\(\)/);
      expect(engine.getEvents()).toEqual([]);
    });
  });

  describe('cola serie', () => {
    it('dos comandos lanzados sin await en el mismo ms se serializan con seq consecutivos', async () => {
      const { engine, clock } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + 5 * MINUTE);

      // El segundo solo es válido si el primero ya liberó una plaza en el campo.
      const [left, entered] = await Promise.all([engine.playerOut('leo'), engine.playerIn('david', pos(2))]);

      expect([left.seq, entered.seq]).toEqual([3, 4]);
      expect([left.timestamp, entered.timestamp]).toEqual([T0 + 5 * MINUTE, T0 + 5 * MINUTE]);
      expect(engine.getState().players.leo?.location).toBe('BENCH');
      expect(engine.getState().players.david?.location).toBe('FIELD');
      expect(checkInvariants(engine.getState())).toEqual([]);
      expect(engine.playedMs('leo', T0 + 8 * MINUTE)).toBe(5 * MINUTE);
      expect(engine.playedMs('david', T0 + 8 * MINUTE)).toBe(3 * MINUTE);
    });

    it('un comando inválido en medio de la cola no bloquea a los siguientes ni deja huecos en seq', async () => {
      const { engine, clock } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + MINUTE);

      const results = await Promise.allSettled([engine.pause(), engine.pause(), engine.resume()]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
      expect(engine.getState().status).toBe('RUNNING');
      expect(engine.getEvents().map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    });

    it('el instante se captura al recibir el comando, no al ejecutarlo', async () => {
      const { engine, clock } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      const started = engine.start();
      clock.set(T0 + MINUTE);
      const paused = engine.pause();
      clock.set(T0 + 2 * MINUTE);
      expect((await started).timestamp).toBe(T0);
      expect((await paused).timestamp).toBe(T0 + MINUTE);
    });
  });

  describe('comandos inválidos', () => {
    it('no persisten nada, no cambian el estado ni avisan a los suscriptores', async () => {
      const { engine, store, published } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      const before = engine.getState();
      const listener = jest.fn();
      engine.subscribe(listener);
      const publishedBefore = published.length;

      expect(await ruleCode(engine.pause())).toBe('INVALID_STATUS');
      expect(await ruleCode(engine.playerIn('hugo', pos(7)))).toBe('FIELD_FULL');
      expect(await ruleCode(engine.playerIn('nadie', pos(7)))).toBe('UNKNOWN_PLAYER');
      expect(await ruleCode(engine.movePlayer('lucas', { x: 2, y: 0 }))).toBe('INVALID_POSITION');

      expect(engine.getState()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      expect(published).toHaveLength(publishedBefore);
      expect(await store.loadEvents(f7Config().matchId)).toHaveLength(1);
    });
  });

  describe('bus', () => {
    it('publica el tema específico de cada comando y siempre match.event.recorded', async () => {
      const { engine, clock, published, topics } = setup();
      await playReferenceMatch(engine, clock);

      expect(topics()).toEqual([
        'match.event.recorded', // LINEUP_SET: sin tema propio
        'match.started',
        'match.event.recorded',
        'player.substituted',
        'match.event.recorded',
        'match.paused',
        'match.event.recorded',
        'match.resumed',
        'match.event.recorded',
        'match.halftime',
        'match.event.recorded',
        'player.substituted',
        'match.event.recorded',
        'match.period.started',
        'match.event.recorded',
        'match.finished',
        'match.event.recorded',
      ]);
      const matchId = f7Config().matchId;
      expect(published[1]?.payload).toEqual({ matchId, timestamp: T0, period: 1 });
      expect(published[3]?.payload).toEqual({
        matchId,
        inPlayerId: 'hugo',
        outPlayerId: 'lucas',
        timestamp: T0 + 10 * MINUTE,
        matchTimeMs: 10 * MINUTE,
      });
      expect(published[13]?.payload).toEqual({ matchId, timestamp: T0 + 37 * MINUTE, period: 2 });
      expect(published[15]?.payload).toEqual({ matchId, timestamp: T0 + 65 * MINUTE, reason: 'NORMAL' });
      expect(published[16]?.payload).toEqual({ event: engine.getEvents()[8] });
    });

    it('entradas y salidas sueltas publican player.entered / player.left con el minuto de partido', async () => {
      const { engine, clock, published } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + 3 * MINUTE);
      await engine.playerOut('marco');
      clock.set(T0 + 4 * MINUTE);
      await engine.playerIn('david', pos(6));

      const matchId = f7Config().matchId;
      expect(published.filter((p) => p.topic === 'player.left').map((p) => p.payload)).toEqual([
        { matchId, playerId: 'marco', timestamp: T0 + 3 * MINUTE, matchTimeMs: 3 * MINUTE },
      ]);
      expect(published.filter((p) => p.topic === 'player.entered').map((p) => p.payload)).toEqual([
        { matchId, playerId: 'david', timestamp: T0 + 4 * MINUTE, matchTimeMs: 4 * MINUTE },
      ]);
    });
  });

  describe('eventos externos', () => {
    it('un GOAL entra en la timeline con el reloj actual sin cambiar el estado ni los minutos', async () => {
      const { engine, clock, topics } = setup();
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      clock.set(T0 + 7 * MINUTE);
      const before = engine.getState();
      const topicsBefore = topics().length;

      const goal = await engine.recordExternalEvent({ type: 'GOAL', timestamp: T0 + 7 * MINUTE, playerId: 'leo', metadata: {} });

      expect(goal).toMatchObject({ type: 'GOAL', seq: 3, playerId: 'leo', source: 'user', matchTimeMs: 7 * MINUTE, period: 1 });
      expect({ ...engine.getState(), lastSeq: before.lastSeq }).toEqual(before);
      expect(engine.getState().lastSeq).toBe(3);
      expect(engine.playedMs('leo', T0 + 10 * MINUTE)).toBe(10 * MINUTE);
      expect(engine.getTimeline()).toContainEqual(goal);
      expect(topics().slice(topicsBefore)).toEqual(['match.event.recorded']);
      // Un gol anotado por el usuario sí se puede deshacer; uno de cámara, no.
      expect(engine.peekUndo()).toEqual(goal);
      await engine.recordExternalEvent({
        type: 'CAMERA_ZONE_CHANGED',
        timestamp: T0 + 8 * MINUTE,
        source: 'camera',
        metadata: { zone: 'LEFT', previousZone: null },
      });
      expect(engine.peekUndo()).toEqual(goal);
    });

    it('se admiten también con el partido finalizado', async () => {
      const { engine, clock } = setup();
      await playReferenceMatch(engine, clock);
      const card = await engine.recordExternalEvent({ type: 'YELLOW_CARD', timestamp: T0 + 66 * MINUTE, playerId: 'hugo', metadata: {} });
      expect(card).toMatchObject({ matchTimeMs: 53 * MINUTE, period: 2 });
      expect(engine.getState().status).toBe('FINISHED');
    });

    it('rechaza con INVALID_EVENT los tipos que afectan al estado y EVENT_UNDONE, sin persistir nada', async () => {
      const { engine, store } = setup();
      await engine.load();
      const rejected: MatchEventType[] = ['MATCH_PAUSED', 'PLAYER_LEFT', 'LINEUP_SET', 'EVENT_UNDONE'];
      for (const type of rejected) {
        const code = await ruleCode(
          engine.recordExternalEvent({ type, timestamp: T0, metadata: {} } as Parameters<typeof engine.recordExternalEvent>[0]),
        );
        expect(code).toBe('INVALID_EVENT');
      }
      expect(await store.loadEvents(f7Config().matchId)).toEqual([]);
      expect(engine.getState().lastSeq).toBe(0);
    });
  });

  describe('suscripción', () => {
    it('notifica solo estados ya persistidos y deja de hacerlo al desuscribirse', async () => {
      const { engine, store, clock } = setup();
      const seen: string[] = [];
      const unsubscribe = engine.subscribe(async (state) => {
        // En el momento de la notificación, el almacén ya tiene el evento.
        const stored = await store.loadEvents(f7Config().matchId);
        seen.push(`${state.status}:${stored.length}`);
      });
      await engine.load();
      await engine.setLineup(lineup(FIELD), [...SUBS]);
      clock.set(T0);
      await engine.start();
      // Las comprobaciones del listener son asíncronas: se espera a que terminen.
      await new Promise((resolve) => setTimeout(resolve, 0));
      unsubscribe();
      await engine.pause();

      expect(seen).toEqual(['DRAFT:0', 'READY:1', 'RUNNING:2']);
    });
  });
});

describeWithSqlite('createMatchEngine sobre SQLite real', () => {
  it('flujo completo + deshacer + recuperación con el SqliteEventStore', async () => {
    const db = createNodeSqliteDouble(openMemoryDatabase());
    await migrate(db);
    const store = createSqliteEventStore(db, { now: () => T0 });
    const { engine, clock } = setup(store);
    await playReferenceMatch(engine, clock);
    clock.set(T0 + 66 * MINUTE);
    await engine.undo();

    const second = createMatchEngine({ config: f7Config(), store, bus: createEventBus<AppBusEventMap>(), now: clock.now });
    await second.load();

    expect(second.getState()).toEqual(engine.getState());
    expect(second.getEvents()).toEqual(engine.getEvents());
    expect(second.getEvents().map((e) => e.type)).toContain('EVENT_UNDONE');
    expect(second.playedMs('hugo', T0 + 66 * MINUTE)).toBe(44 * MINUTE);
  });
});
