import type { MatchEvent } from '../../core/events';
import { EventStoreError, type EventStore } from '../eventStore';
import { createInMemoryEventStore } from '../inMemoryEventStore';
import { eventToRow, rowToEvent } from '../mappers';
import { migrate } from '../migrate';
import { createSqliteEventStore } from '../sqliteEventStore';
import { MATCH_ID, T0, makeEvent } from './fixtures';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';

/**
 * REVISIÓN (durabilidad y recuperación), capa de persistencia. Todo pasa:
 * queda como red de seguridad de lo que el contrato no cubría.
 *
 * - 0 frente a null: `voidedAt = 0`, `timestamp = 0`, `matchTimeMs = 0` y
 *   `period = 0` tienen que sobrevivir al mapper y a los dos almacenes sin
 *   convertirse en null (ni al revés). Un `??` mal puesto los confundiría.
 * - Atomicidad REAL de `appendMany` y `updateDerived` con un fallo que no es
 *   UNIQUE (NOT NULL): el contrato solo prueba el duplicado.
 * - `markVoided` no borra ni toca otra columna, y la conexión principal no
 *   queda con una transacción abierta tras un ROLLBACK.
 */

/** Todos los campos numéricos a 0 y los nulos a null: el caso que `??` confundiría. */
const zeroEvent = (): MatchEvent =>
  makeEvent(1, { timestamp: 0, matchTimeMs: 0, period: 0, voidedAt: 0, playerId: null, secondaryPlayerId: '0' });

describe('review-durabilidad: mapper, 0 frente a null', () => {
  it('eventToRow / rowToEvent conservan 0 en voided_at, timestamp, match_time_ms y period, y null en player_id', () => {
    const event = zeroEvent();
    const row = eventToRow(event, 0);
    expect(row).toMatchObject({
      voided_at: 0,
      timestamp: 0,
      match_time_ms: 0,
      period: 0,
      player_id: null,
      secondary_player_id: '0',
      created_at: 0,
    });
    expect(rowToEvent(row)).toStrictEqual(event);
  });
});

/** La misma batería para los dos almacenes: el motor no debe notar la diferencia. */
async function expectZeroVsNull(store: EventStore): Promise<void> {
  const event = zeroEvent();
  await store.append(event);
  expect(await store.loadEvents(MATCH_ID)).toStrictEqual([event]);

  // voidedAt = 0 ya cuenta como anulado: markVoided no lo sobreescribe.
  await store.markVoided(MATCH_ID, event.id, T0);
  expect((await store.loadEvents(MATCH_ID))[0]?.voidedAt).toBe(0);

  // Un evento vivo anulado "en el instante 0" queda en 0 y no vuelve a cambiar.
  const live = makeEvent(2);
  await store.append(live);
  await store.markVoided(MATCH_ID, live.id, 0);
  await store.markVoided(MATCH_ID, live.id, T0);
  expect((await store.loadEvents(MATCH_ID))[1]?.voidedAt).toBe(0);

  // Derivados a 0 sobre valores que no lo eran (deshacer MATCH_STARTED hace justo esto).
  await store.updateDerived(MATCH_ID, [{ id: live.id, matchTimeMs: 0, period: 0 }]);
  expect((await store.loadEvents(MATCH_ID))[1]).toStrictEqual({ ...live, voidedAt: 0, matchTimeMs: 0, period: 0 });
}

describe('review-durabilidad: InMemoryEventStore, 0 frente a null', () => {
  it('append, markVoided y updateDerived conservan los ceros', async () => {
    await expectZeroVsNull(createInMemoryEventStore());
  });
});

describeWithSqlite('review-durabilidad: SqliteEventStore contra SQLite real', () => {
  let native: NodeSqliteDatabase;
  let store: EventStore;

  const rowCount = () => (native.prepare('SELECT COUNT(*) AS n FROM match_event').get() as { n: number }).n;

  beforeEach(async () => {
    native = openMemoryDatabase();
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    store = createSqliteEventStore(db, { now: () => T0 });
  });

  afterEach(() => native.close());

  it('append, markVoided y updateDerived conservan los ceros (INTEGER 0 no es NULL)', async () => {
    await expectZeroVsNull(store);
    const raw = native.prepare('SELECT voided_at, timestamp, match_time_ms, period, player_id FROM match_event WHERE seq = 1').get();
    expect(raw).toMatchObject({ voided_at: 0, timestamp: 0, match_time_ms: 0, period: 0, player_id: null });
  });

  it('appendMany: un fallo que NO es UNIQUE (NOT NULL por timestamp NaN) hace ROLLBACK de todo el lote y se reporta como STORAGE', async () => {
    await store.append(makeEvent(1));
    // NaN se enlaza como NULL y `timestamp` es NOT NULL: falla la tercera fila.
    const batch = [makeEvent(2), makeEvent(3), makeEvent(4, { timestamp: NaN })];
    const error: unknown = await store.appendMany(batch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('STORAGE');
    expect((error as EventStoreError).message).toMatch(/NOT NULL/);

    expect((await store.loadEvents(MATCH_ID)).map((e) => e.seq)).toEqual([1]);
    expect(rowCount()).toBe(1);
    // La conexión no se queda dentro de una transacción abierta: un BEGIN nuevo funciona.
    expect(() => native.exec('BEGIN; ROLLBACK;')).not.toThrow();
    // Y el almacén sigue utilizable con los mismos seq.
    await store.appendMany([makeEvent(2), makeEvent(3)]);
    expect(await store.lastSeq(MATCH_ID)).toBe(3);
  });

  it('updateDerived: si una fila del lote falla, ninguna queda actualizada (todo o nada)', async () => {
    const a = makeEvent(1);
    const b = makeEvent(2);
    await store.appendMany([a, b]);
    const error: unknown = await store
      .updateDerived(MATCH_ID, [
        { id: a.id, matchTimeMs: 99_000, period: 2 },
        { id: b.id, matchTimeMs: NaN, period: 2 }, // NULL en match_time_ms NOT NULL
      ])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('STORAGE');
    // El primer UPDATE (válido) también se deshizo.
    expect(await store.loadEvents(MATCH_ID)).toStrictEqual([a, b]);
  });

  it('markVoided no borra ni altera otra columna: mismas filas, misma fila salvo voided_at, y repetirlo no cambia nada', async () => {
    const a = makeEvent(1, { type: 'SUBSTITUTION', playerId: 'hugo', secondaryPlayerId: 'lucas', metadata: { position: { x: 0.3, y: 0.7 } } });
    const b = makeEvent(2);
    await store.appendMany([a, b]);
    const before = native.prepare('SELECT * FROM match_event WHERE id = ?').get(a.id) as Record<string, unknown>;

    await store.markVoided(MATCH_ID, a.id, T0 + 60_000);
    await store.markVoided(MATCH_ID, a.id, T0 + 99_000);

    expect(rowCount()).toBe(2);
    const after = native.prepare('SELECT * FROM match_event WHERE id = ?').get(a.id) as Record<string, unknown>;
    expect(after).toEqual({ ...before, voided_at: T0 + 60_000 });
    expect(await store.loadEvents(MATCH_ID)).toStrictEqual([{ ...a, voidedAt: T0 + 60_000 }, b]);
    // El seq anulado sigue ocupado: nadie lo reutiliza.
    expect(await store.lastSeq(MATCH_ID)).toBe(2);
    const dup: unknown = await store.append(makeEvent(1, { id: 'otro' })).catch((e: unknown) => e);
    expect((dup as EventStoreError).code).toBe('DUPLICATE_SEQ');
  });
});
