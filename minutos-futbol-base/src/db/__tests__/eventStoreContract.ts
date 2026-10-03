import type { MatchEvent } from '../../core/events';
import { EventStoreError, type EventStore } from '../eventStore';
import { MATCH_ID, SAMPLE_METADATA, T0, makeEvent } from './fixtures';

/**
 * Batería del contrato `EventStore`. Toda implementación (memoria, SQLite...)
 * la ejecuta entera: el MatchEngine se apoya en estas garantías y no debe
 * notar la diferencia entre una y otra.
 */

async function storeError(promise: Promise<unknown>): Promise<EventStoreError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EventStoreError);
  return error as EventStoreError;
}

export function describeEventStoreContract(name: string, factory: () => Promise<EventStore> | EventStore): void {
  describe(`${name}: contrato EventStore`, () => {
    let store: EventStore;

    beforeEach(async () => {
      store = await factory();
    });

    describe('append', () => {
      it('guarda el evento y lo devuelve idéntico; lastSeq avanza', async () => {
        const event = makeEvent(1);
        await store.append(event);
        expect(await store.loadEvents(MATCH_ID)).toEqual([event]);
        expect(await store.lastSeq(MATCH_ID)).toBe(1);
      });

      it('conserva voidedAt, playerId nulo y secondaryPlayerId', async () => {
        const event = makeEvent(1, {
          type: 'SUBSTITUTION',
          playerId: 'marco',
          secondaryPlayerId: 'lucas',
          metadata: SAMPLE_METADATA.SUBSTITUTION,
          voidedAt: T0 + 5000,
        });
        const noPlayer = makeEvent(2, { type: 'MATCH_PAUSED', playerId: null, metadata: {}, source: 'system' });
        await store.append(event);
        await store.append(noPlayer);
        expect(await store.loadEvents(MATCH_ID)).toEqual([event, noPlayer]);
      });

      it('rechaza (matchId, seq) duplicado con DUPLICATE_SEQ y no guarda nada', async () => {
        await store.append(makeEvent(1));
        const error = await storeError(store.append(makeEvent(1, { id: 'otro-id' })));
        expect(error.code).toBe('DUPLICATE_SEQ');
        expect(await store.loadEvents(MATCH_ID)).toHaveLength(1);
      });

      it('rechaza un id duplicado con DUPLICATE_SEQ', async () => {
        await store.append(makeEvent(1));
        const error = await storeError(store.append(makeEvent(2, { id: makeEvent(1).id })));
        expect(error.code).toBe('DUPLICATE_SEQ');
        expect(await store.lastSeq(MATCH_ID)).toBe(1);
      });

      it('permite el mismo seq en partidos distintos', async () => {
        await store.append(makeEvent(1));
        await store.append(makeEvent(1, { matchId: 'otro-partido' }));
        expect(await store.loadEvents(MATCH_ID)).toHaveLength(1);
        expect(await store.loadEvents('otro-partido')).toHaveLength(1);
      });

      it('no comparte referencias con el llamador: mutar el evento después no cambia lo guardado', async () => {
        const event = makeEvent(1, { type: 'LINEUP_SET', playerId: null, metadata: SAMPLE_METADATA.LINEUP_SET });
        const original = JSON.parse(JSON.stringify(event)) as MatchEvent;
        await store.append(event);
        event.timestamp = 0;
        (event.metadata as { field: unknown[] }).field.length = 0;
        expect(await store.loadEvents(MATCH_ID)).toEqual([original]);
      });
    });

    describe('appendMany', () => {
      it('inserta el lote en orden y no hace nada con un lote vacío', async () => {
        await store.appendMany([]);
        await store.appendMany([makeEvent(1), makeEvent(2), makeEvent(3)]);
        expect((await store.loadEvents(MATCH_ID)).map((e) => e.seq)).toEqual([1, 2, 3]);
        expect(await store.lastSeq(MATCH_ID)).toBe(3);
      });

      it('es atómico: un duplicado contra lo guardado deshace todo el lote', async () => {
        await store.append(makeEvent(1));
        const error = await storeError(store.appendMany([makeEvent(2), makeEvent(3), makeEvent(1, { id: 'dup' })]));
        expect(error.code).toBe('DUPLICATE_SEQ');
        expect((await store.loadEvents(MATCH_ID)).map((e) => e.seq)).toEqual([1]);
        expect(await store.lastSeq(MATCH_ID)).toBe(1);
      });

      it('es atómico: un duplicado dentro del propio lote no inserta nada', async () => {
        const error = await storeError(store.appendMany([makeEvent(1), makeEvent(2), makeEvent(2, { id: 'dup' })]));
        expect(error.code).toBe('DUPLICATE_SEQ');
        expect(await store.loadEvents(MATCH_ID)).toEqual([]);
        expect(await store.lastSeq(MATCH_ID)).toBe(0);
      });

      it('guarda 500 eventos y los devuelve todos en orden', async () => {
        const events = Array.from({ length: 500 }, (_, i) => makeEvent(i + 1));
        await store.appendMany(events);
        const loaded = await store.loadEvents(MATCH_ID);
        expect(loaded).toHaveLength(500);
        expect(loaded.map((e) => e.seq)).toEqual(events.map((e) => e.seq));
        expect(loaded[499]).toEqual(events[499]);
        expect(await store.lastSeq(MATCH_ID)).toBe(500);
      });
    });

    describe('loadEvents', () => {
      it('devuelve [] para un partido sin eventos', async () => {
        expect(await store.loadEvents('inexistente')).toEqual([]);
      });

      it('ordena por seq aunque se insertaran desordenados, e incluye los anulados', async () => {
        await store.append(makeEvent(3, { voidedAt: T0 + 9000 }));
        await store.append(makeEvent(1));
        await store.append(makeEvent(2));
        expect((await store.loadEvents(MATCH_ID)).map((e) => e.seq)).toEqual([1, 2, 3]);
      });

      it('solo devuelve los del partido pedido', async () => {
        await store.append(makeEvent(1));
        await store.append(makeEvent(1, { matchId: 'otro' }));
        await store.append(makeEvent(2, { matchId: 'otro' }));
        expect((await store.loadEvents('otro')).map((e) => e.seq)).toEqual([1, 2]);
      });

      it('devuelve copias: mutar el resultado no afecta a la siguiente lectura', async () => {
        await store.append(makeEvent(1, { type: 'LINEUP_SET', playerId: null, metadata: SAMPLE_METADATA.LINEUP_SET }));
        const [first] = await store.loadEvents(MATCH_ID);
        expect(first).toBeDefined();
        first!.voidedAt = 123;
        (first!.metadata as { bench: string[] }).bench.push('intruso');
        const [again] = await store.loadEvents(MATCH_ID);
        expect(again?.voidedAt).toBeNull();
        expect((again?.metadata as { bench: string[] }).bench).toEqual(SAMPLE_METADATA.LINEUP_SET.bench);
      });

      it('conserva metadata con objetos anidados, acentos, ñ, emojis y texto no latino', async () => {
        const metadata = {
          field: [{ playerId: 'Iñaki Muñoz', position: { x: 0.123456789, y: 0 }, goalkeeper: true }],
          bench: ['José María', 'Ángel ⚽', '日本語', 'niño "entre comillas" \\ barra'],
        };
        const event = makeEvent(1, { type: 'LINEUP_SET', playerId: null, metadata });
        const camera = makeEvent(2, {
          type: 'CAMERA_ZONE_CHANGED',
          playerId: null,
          source: 'camera',
          metadata: { zone: 'IZQUIERDA · 📷', previousZone: null },
        });
        await store.appendMany([event, camera]);
        expect(await store.loadEvents(MATCH_ID)).toEqual([event, camera]);
      });
    });

    describe('markVoided', () => {
      it('marca voidedAt y es idempotente (conserva el primer instante)', async () => {
        const event = makeEvent(1);
        await store.append(event);
        await store.markVoided(MATCH_ID, event.id, T0 + 60_000);
        await store.markVoided(MATCH_ID, event.id, T0 + 99_000);
        const [loaded] = await store.loadEvents(MATCH_ID);
        expect(loaded?.voidedAt).toBe(T0 + 60_000);
      });

      it('no toca el resto de campos ni los demás eventos', async () => {
        const a = makeEvent(1);
        const b = makeEvent(2);
        await store.appendMany([a, b]);
        await store.markVoided(MATCH_ID, a.id, T0 + 60_000);
        expect(await store.loadEvents(MATCH_ID)).toEqual([{ ...a, voidedAt: T0 + 60_000 }, b]);
      });

      it('lanza NOT_FOUND si el evento no existe o es de otro partido', async () => {
        const event = makeEvent(1);
        await store.append(event);
        expect((await storeError(store.markVoided(MATCH_ID, 'no-existe', T0))).code).toBe('NOT_FOUND');
        expect((await storeError(store.markVoided('otro-partido', event.id, T0))).code).toBe('NOT_FOUND');
        const [loaded] = await store.loadEvents(MATCH_ID);
        expect(loaded?.voidedAt).toBeNull();
      });
    });

    describe('updateDerived', () => {
      it('actualiza matchTimeMs y period sin tocar timestamp ni metadata', async () => {
        const a = makeEvent(1);
        const b = makeEvent(2);
        await store.appendMany([a, b]);
        await store.updateDerived(MATCH_ID, [
          { id: a.id, matchTimeMs: 90_000, period: 2 },
          { id: b.id, matchTimeMs: 0, period: 0 },
        ]);
        expect(await store.loadEvents(MATCH_ID)).toEqual([
          { ...a, matchTimeMs: 90_000, period: 2 },
          { ...b, matchTimeMs: 0, period: 0 },
        ]);
      });

      it('ignora ids desconocidos o de otro partido y acepta una lista vacía', async () => {
        const a = makeEvent(1);
        const other = makeEvent(1, { matchId: 'otro' });
        await store.appendMany([a, other]);
        await store.updateDerived(MATCH_ID, []);
        await store.updateDerived(MATCH_ID, [
          { id: 'no-existe', matchTimeMs: 1, period: 1 },
          { id: other.id, matchTimeMs: 1, period: 1 },
        ]);
        expect(await store.loadEvents(MATCH_ID)).toEqual([a]);
        expect(await store.loadEvents('otro')).toEqual([other]);
      });
    });

    describe('lastSeq', () => {
      it('es 0 sin eventos y el máximo por partido aunque se inserten desordenados', async () => {
        expect(await store.lastSeq(MATCH_ID)).toBe(0);
        await store.append(makeEvent(7));
        await store.append(makeEvent(3));
        await store.append(makeEvent(9, { matchId: 'otro' }));
        expect(await store.lastSeq(MATCH_ID)).toBe(7);
        expect(await store.lastSeq('otro')).toBe(9);
      });

      it('cuenta también los eventos anulados (el seq no se reutiliza)', async () => {
        const event = makeEvent(4);
        await store.append(event);
        await store.markVoided(MATCH_ID, event.id, T0);
        expect(await store.lastSeq(MATCH_ID)).toBe(4);
      });
    });
  });
}
