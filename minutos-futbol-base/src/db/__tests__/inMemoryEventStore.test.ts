import { createInMemoryEventStore } from '../inMemoryEventStore';
import { describeEventStoreContract } from './eventStoreContract';
import { MATCH_ID, makeEvent } from './fixtures';

describeEventStoreContract('InMemoryEventStore', () => createInMemoryEventStore());

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
