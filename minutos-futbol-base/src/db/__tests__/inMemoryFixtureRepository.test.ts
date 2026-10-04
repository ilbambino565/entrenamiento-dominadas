import { DEFAULT_FIXTURES_STORAGE_KEY, createInMemoryFixtureRepository } from '../inMemoryFixtureRepository';
import { createInMemoryMatchRepository } from '../inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../inMemorySquadRepository';
import { createFakeStorage } from './fakeStorage';
import { describeFixtureRepositoryContract, fixtureRepositoryError, makeFixture } from './fixtureRepositoryContract';
import { TEAM_ID } from './squadRepositoryContract';

describeFixtureRepositoryContract('InMemoryFixtureRepository', () => ({
  fixtures: createInMemoryFixtureRepository(),
  squad: createInMemorySquadRepository(),
  matches: createInMemoryMatchRepository(),
}));

describeFixtureRepositoryContract('InMemoryFixtureRepository (con storage falso)', () => ({
  fixtures: createInMemoryFixtureRepository({ storage: createFakeStorage() }),
  squad: createInMemorySquadRepository(),
  matches: createInMemoryMatchRepository(),
}));

describe('InMemoryFixtureRepository: storage', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('persiste entre instancias: calendario, vínculos y copia legible de un JSON anterior sin matchday_date', async () => {
    const storage = createFakeStorage();
    const first = createInMemoryFixtureRepository({ storage });
    const list = [makeFixture(1, { venue: 'Ciudad - Campo (A)', hasTime: true }), makeFixture(2, { matchdayDate: null })];
    await first.replaceFixtures(TEAM_ID, list);
    await first.linkMatch('fixture-1', 'match-1', 99);

    const second = createInMemoryFixtureRepository({ storage });
    expect(await second.listFixtures(TEAM_ID)).toEqual([{ ...list[0]!, matchId: 'match-1', updatedAt: 99 }, list[1]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('si el storage falla al escribir, rechaza con STORAGE y no cambia nada', async () => {
    const storage = createFakeStorage();
    const repo = createInMemoryFixtureRepository({ storage });
    await repo.replaceFixtures(TEAM_ID, [makeFixture(1)]);

    storage.failNextWrite = new Error('cuota llena');
    expect((await fixtureRepositoryError(repo.replaceFixtures(TEAM_ID, [makeFixture(2)]))).code).toBe('STORAGE');
    expect((await repo.listFixtures(TEAM_ID)).map((f) => f.id)).toEqual(['fixture-1']);

    storage.failNextWrite = new Error('cuota llena');
    expect((await fixtureRepositoryError(repo.linkMatch('fixture-1', 'match-1', 5))).code).toBe('STORAGE');
    expect((await repo.listFixtures(TEAM_ID))[0]?.matchId).toBeNull();
  });

  it.each([
    ['JSON inválido', '{"version":1,"fixtures":['],
    ['versión desconocida', JSON.stringify({ version: 2, fixtures: [] })],
    ['fixtures que no es una lista', JSON.stringify({ version: 1, fixtures: {} })],
    ['home_away desconocido', JSON.stringify({ version: 1, fixtures: [{ ...makeFixture(1), homeAway: 'NEUTRAL' }] })],
    ['rival ausente', JSON.stringify({ version: 1, fixtures: [{ ...makeFixture(1), opponent: undefined }] })],
    ['hasTime que no es booleano', JSON.stringify({ version: 1, fixtures: [{ ...makeFixture(1), hasTime: 'sí' }] })],
    ['un array en vez de un objeto', '[1,2,3]'],
  ])('storage ilegible (%s): lo copia a <clave>.corrupt, no lo pisa y arranca vacío con aviso', async (_label, raw) => {
    const storage = createFakeStorage({ [DEFAULT_FIXTURES_STORAGE_KEY]: raw });
    const repo = createInMemoryFixtureRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.data.get(`${DEFAULT_FIXTURES_STORAGE_KEY}.corrupt`)).toBe(raw);
    expect(storage.data.get(DEFAULT_FIXTURES_STORAGE_KEY)).toBe(raw);
    expect(await repo.listFixtures(TEAM_ID)).toEqual([]);

    await repo.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    expect(JSON.parse(storage.data.get(DEFAULT_FIXTURES_STORAGE_KEY) ?? '')).toMatchObject({ version: 1 });
    expect(storage.data.get(`${DEFAULT_FIXTURES_STORAGE_KEY}.corrupt`)).toBe(raw);
  });

  it('si getItem lanza, arranca vacío con aviso y sigue funcionando', async () => {
    const storage = createFakeStorage();
    storage.getItem = () => {
      throw new Error('acceso denegado');
    };
    const repo = createInMemoryFixtureRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    await repo.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    expect(storage.data.has(DEFAULT_FIXTURES_STORAGE_KEY)).toBe(true);
  });
});
