import { MATCH_EVENT_TYPES, isCameraEvent, isPlayerEvent } from '../../core/events';
import { EventStoreError } from '../eventStore';
import { eventToRow, rowToEvent, type MatchEventRow } from '../mappers';
import { SAMPLE_METADATA, T0, makeEvent } from './fixtures';

describe('mappers: ida y vuelta de todo el catálogo', () => {
  it.each(MATCH_EVENT_TYPES)('%s sobrevive a eventToRow + rowToEvent', (type) => {
    const twoPlayers = type === 'SUBSTITUTION' || type === 'PLAYERS_SWAPPED';
    const event = makeEvent(1, {
      type,
      metadata: SAMPLE_METADATA[type],
      playerId: isPlayerEvent(type) ? 'hugo' : null,
      secondaryPlayerId: twoPlayers ? 'lucas' : null,
      source: isCameraEvent(type) ? 'camera' : type === 'EVENT_UNDONE' ? 'system' : 'user',
    });
    const row = eventToRow(event, T0 + 1);
    expect(row.type).toBe(type);
    expect(typeof row.metadata).toBe('string');
    expect(JSON.parse(row.metadata)).toEqual(SAMPLE_METADATA[type]);
    expect(rowToEvent(row)).toEqual(event);
  });

  it('usa columnas snake_case y traduce null ↔ NULL en jugadores y voided_at', () => {
    const event = makeEvent(3, { type: 'MATCH_ENDED', playerId: null, metadata: { reason: 'NORMAL' }, source: 'user' });
    expect(eventToRow(event, T0 + 10)).toEqual({
      id: event.id,
      match_id: event.matchId,
      seq: 3,
      type: 'MATCH_ENDED',
      timestamp: event.timestamp,
      match_time_ms: event.matchTimeMs,
      period: 1,
      player_id: null,
      secondary_player_id: null,
      metadata: '{"reason":"NORMAL"}',
      source: 'user',
      voided_at: null,
      created_at: T0 + 10,
    });

    const voided = makeEvent(4, { voidedAt: T0 + 50, secondaryPlayerId: 'leo' });
    const row = eventToRow(voided);
    expect(row.voided_at).toBe(T0 + 50);
    expect(row.secondary_player_id).toBe('leo');
    // Sin createdAt explícito, created_at es el timestamp del evento (mapper determinista).
    expect(row.created_at).toBe(voided.timestamp);
    expect(rowToEvent(row)).toEqual(voided);
  });
});

describe('mappers: filas corruptas', () => {
  const validRow = (): MatchEventRow => eventToRow(makeEvent(1));

  const expectStorageError = (row: MatchEventRow, fragment: string) => {
    let error: unknown;
    try {
      rowToEvent(row);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EventStoreError);
    expect((error as EventStoreError).code).toBe('STORAGE');
    expect((error as EventStoreError).message).toContain(row.id);
    expect((error as EventStoreError).message).toContain(fragment);
  };

  it('tipo desconocido', () => {
    expectStorageError({ ...validRow(), type: 'PLAYER_TELEPORTED' }, 'tipo desconocido');
  });

  it('source desconocido', () => {
    expectStorageError({ ...validRow(), source: 'alien' }, 'source desconocido');
  });

  it('metadata que no es JSON válido (con la causa original)', () => {
    const row = { ...validRow(), metadata: '{"position":' };
    expectStorageError(row, 'JSON');
    try {
      rowToEvent(row);
    } catch (error) {
      expect((error as EventStoreError).cause).toBeInstanceOf(SyntaxError);
    }
  });

  it('metadata que no es un objeto (null, array, número)', () => {
    expectStorageError({ ...validRow(), metadata: 'null' }, 'no es un objeto');
    expectStorageError({ ...validRow(), metadata: '[1,2]' }, 'no es un objeto');
    expectStorageError({ ...validRow(), metadata: '42' }, 'no es un objeto');
  });
});
