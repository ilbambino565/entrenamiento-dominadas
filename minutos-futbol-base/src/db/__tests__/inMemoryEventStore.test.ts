import { EventStoreError } from '../eventStore';
import { DEFAULT_EVENTS_STORAGE_KEY, createInMemoryEventStore } from '../inMemoryEventStore';
import { describeEventStoreContract } from './eventStoreContract';
import { createFakeStorage } from './fakeStorage';
import { MATCH_ID, makeEvent } from './fixtures';

describeEventStoreContract('InMemoryEventStore', () => createInMemoryEventStore());
describeEventStoreContract('InMemoryEventStore (con storage falso)', () => createInMemoryEventStore({ storage: createFakeStorage() }));

describe('InMemoryEventStore: extras', () => {
  it('snapshot devuelve copias de todos los partidos en orden de inserción', async () => {
    const store = createInMemoryEventStore();
    const a = makeEvent(2);
    const b = makeEvent(1, { matchId: 'otro' });
    await store.appendMany([a, b]);

    const snapshot = store.snapshot();
    expect(snapshot).toEqual([a, b]);
    snapshot[0]!.seq = 99;
    expect(store.snapshot()[0]?.seq).toBe(2);
  });

  it('clear vacía el almacén y permite reutilizar los seq', async () => {
    const store = createInMemoryEventStore();
    await store.append(makeEvent(1));
    store.clear();
    expect(store.snapshot()).toEqual([]);
    expect(await store.lastSeq(MATCH_ID)).toBe(0);
    await expect(store.append(makeEvent(1))).resolves.toBeUndefined();
  });
});

describe('InMemoryEventStore: storage', () => {
  const key = (matchId: string) => `${DEFAULT_EVENTS_STORAGE_KEY}.${matchId}`;
  const rejection = async (promise: Promise<unknown>): Promise<EventStoreError> => {
    const error: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EventStoreError);
    return error as EventStoreError;
  };

  it('persiste entre instancias con el mismo storage: eventos, anulados y derivados, cada partido en su clave', async () => {
    const storage = createFakeStorage();
    const first = createInMemoryEventStore({ storage });
    const a1 = makeEvent(1);
    const a2 = makeEvent(2);
    const b1 = makeEvent(1, { matchId: 'otro' });
    await first.appendMany([a1, a2]);
    await first.append(b1);
    await first.markVoided(MATCH_ID, a2.id, 5000);
    await first.updateDerived(MATCH_ID, [{ id: a1.id, matchTimeMs: 777, period: 2 }]);

    expect([...storage.data.keys()].sort()).toEqual([key('otro'), key(MATCH_ID)].sort());
    const second = createInMemoryEventStore({ storage });
    expect(await second.loadEvents(MATCH_ID)).toEqual([{ ...a1, matchTimeMs: 777, period: 2 }, { ...a2, voidedAt: 5000 }]);
    expect(await second.loadEvents('otro')).toEqual([b1]);
    expect(await second.lastSeq(MATCH_ID)).toBe(2);
    await expect(second.append(makeEvent(2))).rejects.toMatchObject({ code: 'DUPLICATE_SEQ' });
    await second.append(makeEvent(3));
    expect(await createInMemoryEventStore({ storage }).lastSeq(MATCH_ID)).toBe(3);
  });

  it('cada escritura toca solo la clave de su partido y las lecturas no escriben', async () => {
    const storage = createFakeStorage();
    const store = createInMemoryEventStore({ storage });
    await store.append(makeEvent(1, { matchId: 'otro' }));
    const before = storage.data.get(key('otro'));
    expect(storage.writes).toBe(1);

    await store.append(makeEvent(1));
    await store.loadEvents(MATCH_ID);
    await store.lastSeq(MATCH_ID);
    expect(storage.writes).toBe(2);
    expect(storage.data.get(key('otro'))).toBe(before);
  });

  it('si el storage falla al escribir, rechaza con STORAGE y no cambia nada (se puede reintentar el mismo seq)', async () => {
    const storage = createFakeStorage();
    const store = createInMemoryEventStore({ storage });
    const e1 = makeEvent(1);
    await store.append(e1);

    storage.failNextWrite = new Error('cuota llena');
    const error = await rejection(store.append(makeEvent(2)));
    expect(error.code).toBe('STORAGE');
    expect(await store.lastSeq(MATCH_ID)).toBe(1);
    expect(await store.loadEvents(MATCH_ID)).toEqual([e1]);
    await expect(store.append(makeEvent(2))).resolves.toBeUndefined();

    storage.failNextWrite = new Error('cuota llena');
    expect((await rejection(store.markVoided(MATCH_ID, e1.id, 9))).code).toBe('STORAGE');
    expect((await store.loadEvents(MATCH_ID))[0]?.voidedAt).toBeNull();

    storage.failNextWrite = new Error('cuota llena');
    expect((await rejection(store.updateDerived(MATCH_ID, [{ id: e1.id, matchTimeMs: 5, period: 1 }]))).code).toBe('STORAGE');
    expect((await store.loadEvents(MATCH_ID))[0]?.matchTimeMs).toBe(e1.matchTimeMs);
  });

  it.each([
    ['JSON inválido', '{"version":1,"events":['],
    ['versión desconocida', JSON.stringify({ version: 2, events: [] })],
    ['events que no es una lista', JSON.stringify({ version: 1, events: {} })],
    ['tipo de evento desconocido', JSON.stringify({ version: 1, events: [{ id: 'x', match_id: MATCH_ID, seq: 1, type: 'GOL_DE_PLACA', timestamp: 1, match_time_ms: 0, period: 0, player_id: null, secondary_player_id: null, metadata: '{}', source: 'user', voided_at: null, created_at: 1 }] })],
    ['un array en vez de un objeto', '[1,2]'],
  ])('timeline ilegible (%s): rechaza con STORAGE, no la pisa y no deja escribir encima', async (_label, raw) => {
    const storage = createFakeStorage({ [key(MATCH_ID)]: raw });
    const store = createInMemoryEventStore({ storage });
    expect((await rejection(store.loadEvents(MATCH_ID))).code).toBe('STORAGE');
    expect((await rejection(store.append(makeEvent(1)))).code).toBe('STORAGE');
    expect(storage.data.get(key(MATCH_ID))).toBe(raw);
    expect(storage.writes).toBe(0);
    // Otro partido sigue funcionando.
    await expect(store.append(makeEvent(1, { matchId: 'otro' }))).resolves.toBeUndefined();
  });

  it('un evento de otro partido dentro de la clave de este se considera corrupción', async () => {
    const other = createFakeStorage();
    await createInMemoryEventStore({ storage: other }).append(makeEvent(1, { matchId: 'otro' }));
    const storage = createFakeStorage({ [key(MATCH_ID)]: other.data.get(key('otro'))! });
    expect((await rejection(createInMemoryEventStore({ storage }).loadEvents(MATCH_ID))).code).toBe('STORAGE');
  });

  it('si getItem lanza, rechaza con STORAGE y se recupera cuando vuelve a funcionar', async () => {
    const storage = createFakeStorage();
    const getItem = storage.getItem;
    storage.getItem = () => {
      throw new Error('acceso denegado');
    };
    const store = createInMemoryEventStore({ storage });
    expect((await rejection(store.loadEvents(MATCH_ID))).code).toBe('STORAGE');
    storage.getItem = getItem;
    expect(await store.loadEvents(MATCH_ID)).toEqual([]);
  });

  it('respeta storageKey', async () => {
    const storage = createFakeStorage();
    await createInMemoryEventStore({ storage, storageKey: 'pruebas.eventos' }).append(makeEvent(1));
    expect([...storage.data.keys()]).toEqual([`pruebas.eventos.${MATCH_ID}`]);
  });
});
