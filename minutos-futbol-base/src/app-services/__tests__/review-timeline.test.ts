import fc from 'fast-check';
import { createDummyCameraController, type CameraSettings } from '../../camera';
import {
  changedDerivedFields,
  checkInvariants,
  deriveEventFields,
  matchClockMs,
  periodClockMs,
  playerPlayedMs,
  reduceMatch,
  substitutionLog,
  toMatchTimeMs,
  type LineupEntry,
  type MatchEvent,
  type MatchState,
  type PlayerInterval,
} from '../../core';
import { EventFactory, MINUTE, SECOND, STARTERS, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { createInMemoryEventStore, createSqliteEventStore, migrate, type EventStore } from '../../db';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from '../../db/__tests__/nodeSqlite';
import { createEventBus } from '../../events/bus';
import { createMatchSession } from '../createMatchSession';
import { createMatchEngine, type AppBusEventMap } from '../matchEngine';

/**
 * REVISIÓN: la timeline como base de la sincronización con vídeo y de la
 * corrección de errores (docs/07 §7.4-7.5, docs/03 §3.5).
 *
 * Bloques:
 *  1. Navegación "ficha de Hugo → momentos del vídeo" usando SOLO la timeline
 *     (en memoria y, si hay node:sqlite, con la SQL documentada sobre el esquema real).
 *  2. Propiedad: comandos aleatorios + deshacer ⇒ seq consecutivos, voidedAt
 *     conservado, EVENT_UNDONE correcto, derivados == recomputados, todo serializable.
 *  3. Corrección posterior de un timestamp y regeneración (dominio puro).
 *  4. HALLAZGOS (fallan a propósito): deshacer que falla en el paso 4, load() sin
 *     reparar derivados obsoletos, timestamp NaN aceptado.
 */

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const MATCH_ID = f7Config().matchId;
const lineup = (ids: readonly string[]): LineupEntry[] =>
  ids.map((playerId, i) => ({ playerId, position: pos(i), goalkeeper: playerId === 'lucas' }));

const ZONES_SETTINGS: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  deviceType: 'dummy',
  zones: { FAR_LEFT: null, LEFT: null, CENTER: { pan: 0, tilt: 0 }, RIGHT: null, FAR_RIGHT: null },
};

/** El puente registra en la timeline por la cola del motor: hay que dejar pasar un tick. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function clockAndIds() {
  let t = T0;
  let n = 0;
  return {
    now: () => t,
    set: (ms: number) => void (t = ms),
    newId: () => `id-${String(++n).padStart(3, '0')}`,
  };
}

// ───────────────────────── 1. Ficha de Hugo → momentos del vídeo ─────────────────────────

/**
 * Partido con dos grabaciones (una por parte), un gol de Hugo, un cambio
 * accidental deshecho y el cambio real. Tiempos relativos a T0 = pitido:
 *
 *   3:00 REC R1        10:00 Hugo entra por Lucas      12:00-14:00 pausa
 *  20:00 GOL Hugo      27:00 descanso                  27:30 STOP R1
 *  30:00 Adrián por Mateo (descanso)                   36:00 REC R2
 *  37:00 2ª parte      45:00 David por Hugo (ERROR)    45:20 DESHACER
 *  50:00 David por Hugo                                65:00 final   66:00 STOP R2
 */
async function playTwoRecordingMatch(store: EventStore) {
  const clock = clockAndIds();
  const dummy = createDummyCameraController({ now: clock.now });
  const session = createMatchSession({
    config: f7Config(),
    store,
    cameraSettings: ZONES_SETTINGS,
    cameraController: dummy,
    now: clock.now,
    newId: clock.newId,
  });
  const { engine, camera } = session;
  await engine.load();
  await engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
  await engine.start();
  clock.set(T0 + MINUTE);
  await camera.connect();
  clock.set(T0 + 3 * MINUTE);
  await camera.startRecording();
  clock.set(T0 + 10 * MINUTE);
  await engine.substitute('hugo', 'lucas');
  clock.set(T0 + 12 * MINUTE);
  await engine.pause();
  clock.set(T0 + 14 * MINUTE);
  await engine.resume();
  clock.set(T0 + 20 * MINUTE);
  await engine.recordExternalEvent({ type: 'GOAL', timestamp: clock.now(), playerId: 'hugo', metadata: {} });
  clock.set(T0 + 27 * MINUTE);
  await engine.startHalftime();
  clock.set(T0 + 27 * MINUTE + 30 * SECOND);
  await camera.stopRecording();
  clock.set(T0 + 30 * MINUTE);
  await engine.substitute('adrian', 'mateo');
  clock.set(T0 + 36 * MINUTE);
  await camera.startRecording();
  clock.set(T0 + 37 * MINUTE);
  await engine.startNextPeriod();
  clock.set(T0 + 45 * MINUTE);
  const accidental = await engine.substitute('david', 'hugo');
  clock.set(T0 + 45 * MINUTE + 20 * SECOND);
  const undone = await engine.undo();
  clock.set(T0 + 50 * MINUTE);
  await engine.substitute('david', 'hugo');
  clock.set(T0 + 65 * MINUTE);
  await engine.end();
  clock.set(T0 + 66 * MINUTE);
  await camera.stopRecording();
  await settle();
  return { session, accidental, undone };
}

interface Recording {
  recordingId: string;
  startedAt: number;
  endedAt: number | null;
}

/** Grabaciones a partir de la timeline: un CAMERA_RECORDING_STARTED por grabación, cerrado por su STOPPED. */
function recordingsOf(timeline: readonly MatchEvent[]): Recording[] {
  const out: Recording[] = [];
  for (const e of timeline) {
    if (e.type === 'CAMERA_RECORDING_STARTED') {
      out.push({ recordingId: (e as MatchEvent<'CAMERA_RECORDING_STARTED'>).metadata.recordingId, startedAt: e.timestamp, endedAt: null });
    } else if (e.type === 'CAMERA_RECORDING_STOPPED') {
      const id = (e as MatchEvent<'CAMERA_RECORDING_STOPPED'>).metadata.recordingId;
      const rec = out.find((r) => r.recordingId === id);
      if (rec) rec.endedAt = e.timestamp;
    }
  }
  return out;
}

/** Grabación activa en un instante real (docs/07 §7.5: "cada evento se asigna a la grabación activa en su timestamp"). */
const recordingAt = (recordings: readonly Recording[], ts: number): Recording | null =>
  recordings.find((r) => r.startedAt <= ts && (r.endedAt == null || ts <= r.endedAt)) ?? null;

/** offset de E dentro del vídeo R = Te − T0 (docs/07 §7.5). */
const offsetIn = (rec: Recording, ts: number): number => Math.max(0, ts - rec.startedAt);

/** Clip = intervalo del jugador ∩ grabación, en offsets del vídeo. null si no se tocan. */
function clipOf(interval: PlayerInterval, rec: Recording, now: number): { from: number; to: number } | null {
  const start = Math.max(interval.startedAt, rec.startedAt);
  const end = Math.min(interval.endedAt ?? now, rec.endedAt ?? now);
  if (end <= start) return null;
  return { from: offsetIn(rec, start), to: offsetIn(rec, end) };
}

/** "Momentos de Hugo" sin SQL: el mismo predicado que la consulta documentada. */
const eventsOfPlayer = (events: readonly MatchEvent[], playerId: string) =>
  events.filter((e) => e.playerId === playerId || e.secondaryPlayerId === playerId);

describe('review-timeline: ficha de Hugo → momentos del vídeo usando solo la timeline', () => {
  it('localiza los eventos de Hugo, los asigna a la grabación correcta y genera sus clips desde PlayerInterval', async () => {
    const store = createInMemoryEventStore();
    const { session, accidental, undone } = await playTwoRecordingMatch(store);
    // Solo la timeline persistida: lo mismo que vería una pantalla abierta más tarde.
    const all = await store.loadEvents(MATCH_ID);
    const timeline = all.filter((e) => e.voidedAt == null);

    // Varias grabaciones por partido: dos ids distintos, cada una con su cierre.
    const recordings = recordingsOf(timeline);
    expect(recordings).toHaveLength(2);
    const [r1, r2] = recordings as [Recording, Recording];
    expect(r1.recordingId).not.toBe(r2.recordingId);
    expect(r1).toMatchObject({ startedAt: T0 + 3 * MINUTE, endedAt: T0 + 27 * MINUTE + 30 * SECOND });
    expect(r2).toMatchObject({ startedAt: T0 + 36 * MINUTE, endedAt: T0 + 66 * MINUTE });

    // Momentos de Hugo (playerId o secondaryPlayerId): entra, marca, sale. El accidental no está.
    const hugo = eventsOfPlayer(timeline, 'hugo');
    expect(hugo.map((e) => [e.type, e.playerId, e.secondaryPlayerId])).toEqual([
      ['SUBSTITUTION', 'hugo', 'lucas'],
      ['GOAL', 'hugo', null],
      ['SUBSTITUTION', 'david', 'hugo'],
    ]);
    expect(hugo.some((e) => e.id === accidental.id)).toBe(false);

    // Offset de cada momento dentro de SU grabación: aritmética sobre timestamps reales.
    const moments = hugo.map((e) => {
      const rec = recordingAt(recordings, e.timestamp);
      return rec ? { type: e.type, recordingId: rec.recordingId, offsetMs: offsetIn(rec, e.timestamp) } : null;
    });
    expect(moments).toEqual([
      { type: 'SUBSTITUTION', recordingId: r1.recordingId, offsetMs: 7 * MINUTE },
      { type: 'GOAL', recordingId: r1.recordingId, offsetMs: 17 * MINUTE },
      { type: 'SUBSTITUTION', recordingId: r2.recordingId, offsetMs: 14 * MINUTE },
    ]);
    // El cambio del descanso (30:00) cae entre grabaciones: no pertenece a ninguna.
    const halftimeSub = timeline.find((e) => e.type === 'SUBSTITUTION' && e.playerId === 'adrian');
    expect(recordingAt(recordings, halftimeSub!.timestamp)).toBeNull();

    // Clips: PlayerInterval regenerado desde la timeline ∩ cada grabación.
    const state = reduceMatch(f7Config(), timeline);
    const hugoIntervals = state.intervals.filter((i) => i.playerId === 'hugo');
    expect(hugoIntervals).toEqual([
      expect.objectContaining({ startedAt: T0 + 10 * MINUTE, endedAt: T0 + 50 * MINUTE }),
    ]);
    const now = T0 + 70 * MINUTE;
    const clips = recordings.flatMap((rec) => hugoIntervals.map((i) => ({ recordingId: rec.recordingId, clip: clipOf(i, rec, now) })));
    expect(clips).toEqual([
      { recordingId: r1.recordingId, clip: { from: 7 * MINUTE, to: 24 * MINUTE + 30 * SECOND } },
      { recordingId: r2.recordingId, clip: { from: 0, to: 14 * MINUTE } },
    ]);
    // Los intervalos enlazan con los eventos de la timeline que los abrieron y cerraron.
    const first = hugoIntervals[0]!;
    expect(timeline.find((e) => e.id === first.startEventId)).toMatchObject({ type: 'SUBSTITUTION', playerId: 'hugo' });
    expect(timeline.find((e) => e.id === first.endEventId)).toMatchObject({ type: 'SUBSTITUTION', secondaryPlayerId: 'hugo' });

    // Deshacer: el accidental sigue en la timeline completa (anulado), y EVENT_UNDONE apunta a él.
    const stored = all.find((e) => e.id === accidental.id);
    expect(stored?.voidedAt).toBe(T0 + 45 * MINUTE + 20 * SECOND);
    expect(undone?.id).toBe(accidental.id);
    const marker = all.find((e) => e.type === 'EVENT_UNDONE') as MatchEvent<'EVENT_UNDONE'> | undefined;
    expect(marker?.metadata.targetEventId).toBe(accidental.id);
    expect(marker!.seq).toBeGreaterThan(accidental.seq);
    // El timestamp real del accidental no se ha tocado: su offset en R2 sigue siendo 9:00 (útil para revisar el error).
    expect(offsetIn(r2, stored!.timestamp)).toBe(9 * MINUTE);

    // Exportar: la timeline entera sobrevive a JSON tal cual (sin undefined ni NaN) y seq es 1..n.
    expect(JSON.parse(JSON.stringify(all))).toStrictEqual(all);
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    expect(session.engine.getEvents()).toEqual(all);
  });

  it('OBSERVACIÓN: la consulta documentada (player_id OR secondary_player_id) no devuelve el pitido inicial de un titular; hay que pasar por PlayerInterval', async () => {
    const store = createInMemoryEventStore();
    await playTwoRecordingMatch(store);
    const timeline = (await store.loadEvents(MATCH_ID)).filter((e) => e.voidedAt == null);

    // Lucas es titular: su "entrada" es MATCH_STARTED (sin playerId) y su alineación va dentro
    // de metadata de LINEUP_SET (no indexada). Por columnas solo aparece su salida.
    const lucas = eventsOfPlayer(timeline, 'lucas');
    expect(lucas.map((e) => e.type)).toEqual(['SUBSTITUTION']);
    expect(lucas.some((e) => e.type === 'MATCH_STARTED' || e.type === 'LINEUP_SET')).toBe(false);

    // El modelo sí lo permite: el intervalo del titular referencia el MATCH_STARTED.
    const state = reduceMatch(f7Config(), timeline);
    const interval = state.intervals.find((i) => i.playerId === 'lucas')!;
    const kickoff = timeline.find((e) => e.id === interval.startEventId);
    expect(kickoff).toMatchObject({ type: 'MATCH_STARTED', playerId: null });
    const [r1] = recordingsOf(timeline);
    // Lucas estaba en el campo desde antes de REC: su clip en R1 empieza en 0 y acaba cuando sale (7:00).
    expect(clipOf(interval, r1!, T0 + 70 * MINUTE)).toEqual({ from: 0, to: 7 * MINUTE });
  });
});

describeWithSqlite('review-timeline: la misma navegación con la SQL documentada sobre el esquema real', () => {
  const opened: NodeSqliteDatabase[] = [];
  afterAll(() => {
    for (const db of opened) db.close();
  });

  it('player_id/secondary_player_id, type y timestamp responden a las consultas de docs/07 §7.5 y docs/02 §2.3', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    const store = createSqliteEventStore(db, { now: () => T0 });
    const { accidental } = await playTwoRecordingMatch(store);

    const hugoRows = native
      .prepare('SELECT id, type, voided_at FROM match_event WHERE match_id = ? AND (player_id = ? OR secondary_player_id = ?) ORDER BY seq')
      .all(MATCH_ID, 'hugo', 'hugo') as { id: string; type: string; voided_at: number | null }[];
    // Incluye el anulado (con voided_at): el filtro de válidos es cosa de quien consulta.
    expect(hugoRows.map((r) => [r.type, r.voided_at == null])).toEqual([
      ['SUBSTITUTION', true],
      ['GOAL', true],
      ['SUBSTITUTION', false],
      ['SUBSTITUTION', true],
    ]);
    expect(hugoRows[2]?.id).toBe(accidental.id);

    const recordings = native
      .prepare("SELECT timestamp, metadata FROM match_event WHERE match_id = ? AND type = 'CAMERA_RECORDING_STARTED' ORDER BY timestamp")
      .all(MATCH_ID) as { timestamp: number; metadata: string }[];
    expect(recordings.map((r) => r.timestamp)).toEqual([T0 + 3 * MINUTE, T0 + 36 * MINUTE]);
    const ids = recordings.map((r) => (JSON.parse(r.metadata) as { recordingId: string }).recordingId);
    expect(new Set(ids).size).toBe(2);

    // Eventos dentro de la 2ª grabación, por tiempo real: usa idx_event_match_time.
    const inR2 = native
      .prepare('SELECT type FROM match_event WHERE match_id = ? AND timestamp BETWEEN ? AND ? AND voided_at IS NULL ORDER BY timestamp, seq')
      .all(MATCH_ID, T0 + 36 * MINUTE, T0 + 66 * MINUTE) as { type: string }[];
    expect(inR2.map((r) => r.type)).toEqual([
      'CAMERA_RECORDING_STARTED',
      'PERIOD_STARTED',
      'EVENT_UNDONE',
      'SUBSTITUTION',
      'MATCH_ENDED',
      'CAMERA_RECORDING_STOPPED',
    ]);

    // Planes: ninguna de las tres consultas hace un SCAN completo de la tabla.
    const plan = (sql: string, ...params: unknown[]) =>
      (native.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join(' | ');
    const byPlayer = plan('SELECT * FROM match_event WHERE match_id = ? AND (player_id = ? OR secondary_player_id = ?)', MATCH_ID, 'hugo', 'hugo');
    const byTime = plan('SELECT * FROM match_event WHERE match_id = ? AND timestamp BETWEEN ? AND ?', MATCH_ID, 0, 1);
    expect(byPlayer).not.toMatch(/^SCAN match_event/);
    expect(byTime).toContain('idx_event_match_time');
  });
});

// ───────────────────────── 2. Propiedad: integridad tras comandos aleatorios + deshacer ─────────────────────────

const NUM_RUNS = 40;
const LATE_PLAYERS = ['nico', 'ivan', 'sergio'];

const stepArb = fc.record({
  action: fc.nat(),
  who: fc.nat(),
  gap: fc.integer({ min: 0, max: 3 * MINUTE }),
});
const stepsArb = fc.noBias(fc.array(stepArb, { minLength: 5, maxLength: 45, size: 'max' }));

type Cmd = () => Promise<unknown>;

function engineSetup() {
  const clock = clockAndIds();
  const store = createInMemoryEventStore();
  const bus = createEventBus<AppBusEventMap>();
  const substituted: { inPlayerId: string; outPlayerId: string }[] = [];
  const undoneOnBus: MatchEvent[] = [];
  bus.on('player.substituted', (p) => substituted.push({ inPlayerId: p.inPlayerId, outPlayerId: p.outPlayerId }));
  bus.on('match.event.undone', (p) => undoneOnBus.push(p.event));
  const engine = createMatchEngine({ config: f7Config(), store, bus, now: clock.now, newId: clock.newId });
  return { engine, store, bus, clock, substituted, undoneOnBus };
}

function applicableCommands(engine: ReturnType<typeof engineSetup>['engine'], t: number, who: number): Cmd[] {
  const state = engine.getState();
  const players = Object.values(state.players);
  const known = players.map((p) => p.playerId);
  const field = players.filter((p) => p.location === 'FIELD').map((p) => p.playerId);
  const bench = players.filter((p) => p.location === 'BENCH').map((p) => p.playerId);
  const missing = LATE_PLAYERS.filter((id) => !state.players[id]);
  const full = field.length >= state.config.playersOnField;
  const { status } = state;
  const started = status === 'RUNNING' || status === 'PAUSED' || status === 'HALFTIME';
  const choose = <T,>(xs: readonly T[], salt = 0): T => xs[(who + salt) % xs.length]!;

  const cmds: Cmd[] = [];
  if (status === 'DRAFT') cmds.push(() => engine.setLineup(lineup(FIELD), [...SUBS], t), () => engine.setLineup(lineup(FIELD), [...SUBS], t));
  if (status === 'READY' && field.length) cmds.push(() => engine.start(t), () => engine.start(t), () => engine.start(t));
  if (status === 'RUNNING') cmds.push(() => engine.pause(t));
  if (status === 'PAUSED') cmds.push(() => engine.resume(t), () => engine.resume(t));
  if ((status === 'RUNNING' || status === 'PAUSED') && state.currentPeriod < state.config.periodsCount) {
    cmds.push(() => engine.startHalftime(t));
  }
  if (status === 'HALFTIME') cmds.push(() => engine.startNextPeriod(t), () => engine.startNextPeriod(t));
  if (started && who % 7 === 0) cmds.push(() => engine.end(who % 2 ? 'SUSPENDED' : 'NORMAL', t));

  // Externos: siempre admitidos. Un gol de usuario sí entra en la pila de deshacer; la cámara no.
  cmds.push(() => engine.recordExternalEvent({ type: 'GOAL', timestamp: t, playerId: choose(known), metadata: {} }));
  cmds.push(() =>
    engine.recordExternalEvent({ type: 'CAMERA_RECORDING_STARTED', timestamp: t, source: 'camera', metadata: { recordingId: `rec-${t}`, deviceType: 'dummy' } }),
  );
  // Deshacer con peso: es el centro de esta propiedad.
  if (engine.canUndo()) cmds.push(() => engine.undo(t), () => engine.undo(t));
  if (status === 'FINISHED') return cmds;

  if (bench.length && !full) cmds.push(() => engine.playerIn(choose(bench), pos(field.length), t));
  if (field.length) cmds.push(() => engine.playerOut(choose(field), t));
  if (bench.length && field.length) cmds.push(() => engine.substitute(choose(bench), choose(field, 3), undefined, t));
  if (field.length) cmds.push(() => engine.movePlayer(choose(field), pos(who % 10), t));
  if (field.length >= 2) {
    cmds.push(() => {
      const a = choose(field);
      return engine.swapPlayers(a, choose(field.filter((id) => id !== a), 1), t);
    });
  }
  if (known.length) cmds.push(() => engine.setGoalkeeper(choose(known), t));
  if (missing.length) cmds.push(() => engine.addPlayer(choose(missing), t));
  if (known.length) cmds.push(() => engine.setUnavailable(choose(known), who % 2 === 0, who % 2 === 0 ? 'INJURY' : null, t));
  return cmds;
}

/** Todo lo que debe cumplirse tras CUALQUIER comando. Devuelve el problema o null. */
async function checkTimelineIntegrity(
  s: ReturnType<typeof engineSetup>,
  state: MatchState,
  events: readonly MatchEvent[],
  firstVoidedAt: Map<string, number>,
): Promise<void> {
  // seq consecutivos y únicos, también tras deshacer (los anulados conservan el suyo).
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  expect(state.lastSeq).toBe(events.length);
  // Lo que hay en memoria es exactamente lo persistido, y es serializable sin pérdidas.
  const stored = await s.store.loadEvents(MATCH_ID);
  expect(stored).toStrictEqual([...events]);
  expect(JSON.parse(JSON.stringify(events))).toStrictEqual([...events]);
  // Derivados persistidos == recomputados desde cero en orden de seq.
  expect(deriveEventFields(events)).toStrictEqual([...events]);
  // Estado == regenerar(timeline) y sin invariantes rotas.
  expect(reduceMatch(f7Config(), events)).toEqual(state);
  expect(checkInvariants(state)).toEqual([]);
  // voidedAt nunca se pierde ni cambia; EVENT_UNDONE apunta a un evento de usuario anulado anterior.
  for (const e of events) {
    if (e.voidedAt != null) {
      const first = firstVoidedAt.get(e.id);
      if (first === undefined) firstVoidedAt.set(e.id, e.voidedAt);
      else expect(e.voidedAt).toBe(first);
    } else {
      expect(firstVoidedAt.has(e.id)).toBe(false);
    }
    if (e.type === 'EVENT_UNDONE') {
      const target = events.find((x) => x.id === (e as MatchEvent<'EVENT_UNDONE'>).metadata.targetEventId);
      expect(target).toBeDefined();
      expect(target!.seq).toBeLessThan(e.seq);
      expect(target!.source).toBe('user');
      expect(target!.voidedAt).toBe(e.timestamp);
      expect(e.source).toBe('system');
    }
  }
  // Un deshacer anula exactamente un evento: tantos anulados como EVENT_UNDONE.
  expect(events.filter((e) => e.voidedAt != null)).toHaveLength(events.filter((e) => e.type === 'EVENT_UNDONE').length);
  // Convención SUBSTITUTION (entra / sale) en timeline, stats y bus.
  const log = substitutionLog(events).filter((l) => l.type === 'SUBSTITUTION');
  const subs = events.filter((e) => e.voidedAt == null && e.type === 'SUBSTITUTION');
  expect(log.map((l) => [l.inPlayerId, l.outPlayerId])).toEqual(subs.map((e) => [e.playerId, e.secondaryPlayerId]));
  for (const e of subs) {
    const interval = state.intervals.find((i) => i.startEventId === e.id);
    if (interval) expect(interval.playerId).toBe(e.playerId);
    const closed = state.intervals.find((i) => i.endEventId === e.id);
    if (closed) expect(closed.playerId).toBe(e.secondaryPlayerId);
  }
}

describe('review-timeline: propiedad de integridad de la timeline con deshacer', () => {
  it('comandos aleatorios + deshacer ⇒ seq 1..n, voidedAt estable, EVENT_UNDONE correcto, derivados == recomputados, estado == regenerar', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, async (steps) => {
        const s = engineSetup();
        await s.engine.load();
        const firstVoidedAt = new Map<string, number>();
        let t = T0;
        for (const step of steps) {
          t += step.gap;
          s.clock.set(t);
          const cmds = applicableCommands(s.engine, t, step.who);
          const cmd = cmds[step.action % cmds.length]!;
          await cmd();
          await checkTimelineIntegrity(s, s.engine.getState(), s.engine.getEvents(), firstVoidedAt);
        }
        // El bus respeta la convención: lo publicado como sustitución es lo que hay en la timeline.
        const subs = s.engine.getEvents().filter((e) => e.type === 'SUBSTITUTION');
        expect(s.substituted).toEqual(subs.map((e) => ({ inPlayerId: e.playerId, outPlayerId: e.secondaryPlayerId })));
        // Lo anunciado como deshecho es exactamente lo anulado, en orden.
        const voided = s.engine.getEvents().filter((e) => e.voidedAt != null).sort((a, b) => a.voidedAt! - b.voidedAt! || b.seq - a.seq);
        expect(s.undoneOnBus.map((e) => e.id)).toEqual(voided.map((e) => e.id));
        // Un segundo motor sobre el mismo almacén ve lo mismo.
        const second = createMatchEngine({ config: f7Config(), store: s.store, bus: createEventBus<AppBusEventMap>(), now: s.clock.now });
        expect(await second.load()).toEqual(s.engine.getState());
        expect(second.getEvents()).toStrictEqual(s.engine.getEvents());
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});

// ───────────────────────── 3. Corrección posterior de un timestamp ─────────────────────────

/**
 * 5:00 inicio · 15:00 pausa · 17:00 reanudar · `subAt` Marco por Lucas ·
 * 32:00 descanso · 42:00 2ª parte · 67:00 final. Reloj: 10 + 15 + 25 = 50:00.
 */
function matchForCorrection(subAt: number) {
  const ev = new EventFactory();
  const e = {
    lineup: ev.lineup(T0, STARTERS, 'lucas'),
    start: ev.start(T0 + 5 * MINUTE),
    pause: ev.pause(T0 + 15 * MINUTE),
    resume: ev.resume(T0 + 17 * MINUTE),
    sub: ev.sub(subAt, 'marco', 'lucas'),
    halftime: ev.halftime(T0 + 32 * MINUTE),
    second: ev.nextPeriod(T0 + 42 * MINUTE),
    end: ev.end(T0 + 67 * MINUTE),
  };
  return { e, events: deriveEventFields(Object.values(e)) };
}

/** Lo que haría la corrección de fase 2: cambiar el ts de UN evento y regenerar todo. */
function correctTimestamp(events: readonly MatchEvent[], id: string, timestamp: number) {
  const corrected = events.map((x) => (x.id === id ? { ...x, timestamp } : x));
  return { events: deriveEventFields(corrected), state: reduceMatch(f7Config(), corrected) };
}

describe('review-timeline: corregir el timestamp de un evento y regenerar', () => {
  it('"el descanso empezó 3 minutos antes": minutos, matchTimeMs y period se recalculan; ningún timestamp cambia', () => {
    const { e, events: before } = matchForCorrection(T0 + 20 * MINUTE);
    const { events: after, state } = correctTimestamp(before, e.halftime.id, T0 + 29 * MINUTE);
    const now = T0 + 70 * MINUTE;

    expect(matchClockMs(state.clockSegments, now)).toBe(47 * MINUTE);
    expect(playerPlayedMs(state, 'lucas', now)).toBe(13 * MINUTE); // 10 + 3
    expect(playerPlayedMs(state, 'marco', now)).toBe(34 * MINUTE); // 9 + 25
    expect(checkInvariants(state)).toEqual([]);

    // Solo cambian los derivados posteriores al evento corregido; los timestamps se conservan.
    expect(changedDerivedFields(before, after)).toEqual([
      { id: e.halftime.id, matchTimeMs: 22 * MINUTE, period: 1 },
      { id: e.second.id, matchTimeMs: 22 * MINUTE, period: 2 },
      { id: e.end.id, matchTimeMs: 47 * MINUTE, period: 2 },
    ]);
    expect(after.find((x) => x.id === e.sub.id)).toMatchObject({ matchTimeMs: 13 * MINUTE, period: 1 });
    const originalTs = Object.fromEntries(before.map((x) => [x.id, x.timestamp]));
    for (const x of after) if (x.id !== e.halftime.id) expect(x.timestamp).toBe(originalTs[x.id]);
    // Nada en el modelo lo impide: ni reduceMatch ni deriveEventFields exigen timestamps monótonos.
  });

  it('OBSERVACIÓN: si la corrección cruza un evento con seq menor, su matchTimeMs supera el reloj del periodo', () => {
    // El cambio se hizo a las 31:00 (antes de pulsar DESCANSO a las 32:00); luego se corrige el descanso a las 29:00.
    const { e, events: before } = matchForCorrection(T0 + 31 * MINUTE);
    const { events: after, state } = correctTimestamp(before, e.halftime.id, T0 + 29 * MINUTE);
    const now = T0 + 70 * MINUTE;

    // Los minutos son correctos: Lucas hasta que el reloj paró (22:00), Marco solo la 2ª parte.
    expect(periodClockMs(state.clockSegments, 1, now)).toBe(22 * MINUTE);
    expect(playerPlayedMs(state, 'lucas', now)).toBe(22 * MINUTE);
    expect(playerPlayedMs(state, 'marco', now)).toBe(25 * MINUTE);
    expect(checkInvariants(state)).toEqual([]);

    // Pero el derivado del cambio (seq anterior al descanso) se mide con el segmento aún abierto:
    // 10 + 14 = 24:00 en el periodo 1, cuyo reloj acabó en 22:00. Medido contra TODOS los
    // segmentos válidos sería 22:00 (acotado por el fin del segmento).
    const sub = after.find((x) => x.id === e.sub.id)!;
    expect(sub).toMatchObject({ matchTimeMs: 24 * MINUTE, period: 1 });
    expect(sub.matchTimeMs).toBeGreaterThan(periodClockMs(state.clockSegments, 1, now));
    expect(toMatchTimeMs(state.clockSegments, sub.timestamp)).toBe(22 * MINUTE);
  });
});

// ───────────────────────── 4. HALLAZGOS (fallan a propósito) ─────────────────────────

describe('review-timeline: HALLAZGOS', () => {
  it('BUG: si falla el append de EVENT_UNDONE, undo() rechaza aunque el deshacer YA se aplicó, nadie es notificado y un reintento desharía OTRO evento', async () => {
    const s = engineSetup();
    await s.engine.load();
    await s.engine.setLineup(lineup(FIELD), [...SUBS]);
    await s.engine.start();
    s.clock.set(T0 + 10 * MINUTE);
    const sub = await s.engine.substitute('hugo', 'lucas');
    const listener = jest.fn();
    s.engine.subscribe(listener);

    const realAppend = s.store.append;
    s.store.append = async (e) => {
      if (e.type === 'EVENT_UNDONE') throw new Error('disco lleno');
      return realAppend(e);
    };
    s.clock.set(T0 + 11 * MINUTE);
    const outcome = await s.engine.undo().then(
      () => 'resuelto',
      () => 'rechazado',
    );
    s.store.append = realAppend;

    // Hechos: el cambio está anulado en disco y en memoria...
    expect((await s.store.loadEvents(MATCH_ID)).find((e) => e.id === sub.id)?.voidedAt).toBe(T0 + 11 * MINUTE);
    expect(s.engine.getState().players.hugo?.location).toBe('BENCH');
    // ...y la pila ya apunta al evento anterior: si la UI reintenta tras el "error", deshace MATCH_STARTED.
    expect(s.engine.peekUndo()?.type).toBe('MATCH_STARTED');

    // Lo que debería pasar: o bien la promesa resuelve (el deshacer se hizo), o bien al menos
    // los suscriptores reciben el estado nuevo. Hoy no ocurre ninguna de las dos cosas.
    expect({ outcome, notified: listener.mock.calls.length > 0 }).toEqual({ outcome: 'resuelto', notified: true });
  });

  it('BUG: load() no repara matchTimeMs/period obsoletos (crash entre markVoided y updateDerived): la timeline cargada contradice a deriveEventFields', async () => {
    const s = engineSetup();
    await s.engine.load();
    await s.engine.setLineup(lineup(FIELD), [...SUBS]);
    await s.engine.start();
    s.clock.set(T0 + 12 * MINUTE);
    const pause = await s.engine.pause();
    const camera = await s.engine.recordExternalEvent({
      type: 'CAMERA_RECORDING_STARTED',
      timestamp: T0 + 13 * MINUTE,
      source: 'camera',
      metadata: { recordingId: 'rec-1', deviceType: 'dummy' },
    });
    expect(camera.matchTimeMs).toBe(12 * MINUTE);

    // Crash justo después del paso 1 de undo(): el anulado está en disco, los derivados no se reescribieron.
    await s.store.markVoided(MATCH_ID, pause.id, T0 + 14 * MINUTE);

    const second = createMatchEngine({ config: f7Config(), store: s.store, bus: createEventBus<AppBusEventMap>(), now: s.clock.now });
    await second.load();
    // El estado se regenera bien (gana el log)...
    expect(second.getState().status).toBe('RUNNING');
    // ...pero la timeline expuesta/exportada conserva el minuto antiguo del evento de cámara
    // (12:00 en vez de 13:00) y nada lo corrige hasta que otro deshacer toque esos campos.
    const loaded = second.getEvents().find((e) => e.id === camera.id)!;
    const fresh = deriveEventFields(second.getEvents()).find((e) => e.id === camera.id)!;
    expect(fresh.matchTimeMs).toBe(13 * MINUTE);
    expect(loaded.matchTimeMs).toBe(fresh.matchTimeMs);
  });

  it('BUG: un timestamp NaN se acepta como instante de un comando y contamina el reloj (y se persiste como null en memoria)', async () => {
    const s = engineSetup();
    await s.engine.load();
    await s.engine.setLineup(lineup(FIELD), [...SUBS]);
    await s.engine.start();
    s.clock.set(T0 + 5 * MINUTE);

    const outcome = await s.engine.pause(NaN).then(
      (e) => `aceptado ts=${e.timestamp} matchTimeMs=${e.matchTimeMs}`,
      (e: Error) => `rechazado: ${e.message}`,
    );
    const clock = s.engine.clockMs(T0 + 6 * MINUTE);
    const stored = (await s.store.loadEvents(MATCH_ID)).find((e) => e.type === 'MATCH_PAUSED');
    // Hoy: "aceptado ts=NaN matchTimeMs=NaN", clockMs NaN y timestamp null en el almacén.
    expect({ outcome, clockIsFinite: Number.isFinite(clock), storedTimestamp: stored === undefined ? 'no persistido' : stored.timestamp }).toEqual({
      outcome: expect.stringMatching(/^rechazado/),
      clockIsFinite: true,
      storedTimestamp: 'no persistido',
    });
  });
});
