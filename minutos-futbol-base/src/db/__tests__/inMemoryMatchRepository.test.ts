import { DEFAULT_MATCHES_STORAGE_KEY, createInMemoryMatchRepository } from '../inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../inMemorySquadRepository';
import { createFakeStorage } from './fakeStorage';
import { describeMatchRepositoryContract, makeMatch, makeMatchPlayer, matchRepositoryError } from './matchRepositoryContract';

describeMatchRepositoryContract('InMemoryMatchRepository', () => ({
  matches: createInMemoryMatchRepository(),
  squad: createInMemorySquadRepository(),
}));

describeMatchRepositoryContract('InMemoryMatchRepository (con storage falso)', () => ({
  matches: createInMemoryMatchRepository({ storage: createFakeStorage() }),
  squad: createInMemorySquadRepository(),
}));

describe('InMemoryMatchRepository: storage', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('persiste entre instancias: partidos, convocatoria en orden y progreso', async () => {
    const storage = createFakeStorage();
    const first = createInMemoryMatchRepository({ storage });
    const squad = [makeMatchPlayer('match-1', 1), makeMatchPlayer('match-1', 9, { shirtNumber: null, benchOrder: 2 })];
    await first.createMatch(makeMatch(1, { homeAway: 'HOME', competition: 'Liga ⚽' }), squad);
    await first.createMatch(makeMatch(2), []);
    await first.saveProgress('match-2', { status: 'RUNNING', currentPeriod: 1, startedAt: 5, finishedAt: null, updatedAt: 9 });

    const second = createInMemoryMatchRepository({ storage });
    expect(await second.getMatch('match-1')).toEqual(makeMatch(1, { homeAway: 'HOME', competition: 'Liga ⚽' }));
    expect(await second.listMatchPlayers('match-1')).toEqual(squad);
    expect((await second.findInProgressMatch())?.id).toBe('match-2');
    expect((await second.listRecentMatches()).map((m) => m.id)).toEqual(['match-2', 'match-1']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('si el storage falla al escribir, rechaza con STORAGE y no cambia nada', async () => {
    const storage = createFakeStorage();
    const repo = createInMemoryMatchRepository({ storage });
    await repo.createMatch(makeMatch(1), []);

    storage.failNextWrite = new Error('cuota llena');
    expect((await matchRepositoryError(repo.createMatch(makeMatch(2), []))).code).toBe('STORAGE');
    expect(await repo.getMatch('match-2')).toBeNull();

    storage.failNextWrite = new Error('cuota llena');
    expect((await matchRepositoryError(repo.saveProgress('match-1', { status: 'READY', currentPeriod: 0, startedAt: null, finishedAt: null, updatedAt: 3 }))).code).toBe('STORAGE');
    expect((await repo.getMatch('match-1'))?.status).toBe('DRAFT');
    await expect(createInMemoryMatchRepository({ storage }).listRecentMatches()).resolves.toHaveLength(1);
  });

  it.each([
    ['JSON inválido', '{"version":1,"matches":['],
    ['versión desconocida', JSON.stringify({ version: 2, matches: [], players: {} })],
    ['matches que no es una lista', JSON.stringify({ version: 1, matches: {}, players: {} })],
    ['estado desconocido', JSON.stringify({ version: 1, matches: [{ ...makeMatch(1), status: 'EXTRA' }], players: {} })],
    ['partido sin rival', JSON.stringify({ version: 1, matches: [{ ...makeMatch(1), opponent: undefined }], players: {} })],
    ['booleano que no es booleano', JSON.stringify({ version: 1, matches: [makeMatch(1)], players: { 'match-1': [{ ...makeMatchPlayer('match-1', 1), isGoalkeeper: 'sí' }] } })],
    ['un array en vez de un objeto', '[1,2,3]'],
  ])('storage ilegible (%s): lo copia a <clave>.corrupt, no lo pisa y arranca vacío con aviso', async (_label, raw) => {
    const storage = createFakeStorage({ [DEFAULT_MATCHES_STORAGE_KEY]: raw });
    const repo = createInMemoryMatchRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.data.get(`${DEFAULT_MATCHES_STORAGE_KEY}.corrupt`)).toBe(raw);
    expect(storage.data.get(DEFAULT_MATCHES_STORAGE_KEY)).toBe(raw);
    expect(await repo.listRecentMatches()).toEqual([]);

    await repo.createMatch(makeMatch(1), []);
    expect(JSON.parse(storage.data.get(DEFAULT_MATCHES_STORAGE_KEY) ?? '')).toMatchObject({ version: 1, matches: [makeMatch(1)] });
    expect(storage.data.get(`${DEFAULT_MATCHES_STORAGE_KEY}.corrupt`)).toBe(raw);
  });

  it('si getItem lanza, arranca vacío con aviso y sigue funcionando', async () => {
    const storage = createFakeStorage();
    storage.getItem = () => {
      throw new Error('acceso denegado');
    };
    const repo = createInMemoryMatchRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await repo.listRecentMatches()).toEqual([]);
    await repo.createMatch(makeMatch(1), []);
    expect(storage.data.has(DEFAULT_MATCHES_STORAGE_KEY)).toBe(true);
  });
});

describe('InMemoryMatchRepository: valores no almacenables', () => {
  it('un estado desconocido rechaza con STORAGE y no guarda nada', async () => {
    const repo = createInMemoryMatchRepository();
    const error = await matchRepositoryError(repo.createMatch(makeMatch(1, { status: 'EXTRA' as never }), []));
    expect(error.code).toBe('STORAGE');
    expect(await repo.listRecentMatches()).toEqual([]);
  });

  it('una convocatoria de otro partido rechaza con STORAGE', async () => {
    const repo = createInMemoryMatchRepository();
    const error = await matchRepositoryError(
      repo.createMatch(makeMatch(1), [
        { id: 'x', matchId: 'match-2', playerId: 'player-1', shirtNumber: 1, isGoalkeeper: false, inInitialLineup: false, benchOrder: null },
      ]),
    );
    expect(error.code).toBe('STORAGE');
    expect(await repo.getMatch('match-1')).toBeNull();
  });
});
