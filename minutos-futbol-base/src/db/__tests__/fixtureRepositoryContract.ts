import type { Fixture } from '../../core/fixture';
import { FixtureRepositoryError, type FixtureRepository } from '../fixtureRepository';
import type { MatchRepository } from '../matchRepository';
import type { SquadRepository } from '../squadRepository';
import { T0 } from './fixtures';
import { makeMatch } from './matchRepositoryContract';
import { OTHER_TEAM_ID, TEAM_ID, makeTeam } from './squadRepositoryContract';

/**
 * Batería del contrato `FixtureRepository`. La fábrica devuelve también los
 * repositorios de plantilla y partidos de la misma base: SQLite exige que el
 * equipo (y el partido al vincular) existan antes. Clubes inventados.
 */
export interface FixtureRepositoryHarness {
  fixtures: FixtureRepository;
  squad: SquadRepository;
  matches: MatchRepository;
}

export function makeFixture(n: number, overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: `fixture-${n}`,
    teamId: TEAM_ID,
    matchday: n,
    matchdayDate: T0 + n * 7 * 86_400_000,
    opponent: `RIVAL ${n}`,
    homeAway: n % 2 === 1 ? 'HOME' : 'AWAY',
    venue: null,
    scheduledAt: T0 + n * 7 * 86_400_000,
    hasTime: false,
    competition: '3ª Liga Inventada, Grupo 9',
    season: '2030-2031',
    matchId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export async function fixtureRepositoryError(promise: Promise<unknown>): Promise<FixtureRepositoryError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FixtureRepositoryError);
  return error as FixtureRepositoryError;
}

export function describeFixtureRepositoryContract(name: string, factory: () => Promise<FixtureRepositoryHarness> | FixtureRepositoryHarness): void {
  describe(`${name}: contrato FixtureRepository`, () => {
    let repo: FixtureRepository;
    let harness: FixtureRepositoryHarness;

    beforeEach(async () => {
      harness = await factory();
      repo = harness.fixtures;
      await harness.squad.saveTeam(makeTeam());
      await harness.squad.saveTeam(makeTeam({ id: OTHER_TEAM_ID, name: 'Otro equipo', createdAt: T0 + 1 }));
    });

    it('al principio no hay partidos', async () => {
      expect(await repo.listFixtures(TEAM_ID)).toEqual([]);
    });

    it('guarda y devuelve los partidos idénticos, con los opcionales a null o con valor, por fecha', async () => {
      const withAll = makeFixture(2, { venue: 'Ciudad - Campo Norte (A)', hasTime: true, competition: 'Liga ⚽ Ñandú', season: null, matchdayDate: null });
      const minimal = makeFixture(1, { competition: null, season: null, venue: null });
      await repo.replaceFixtures(TEAM_ID, [withAll, minimal]);
      expect(await repo.listFixtures(TEAM_ID)).toEqual([minimal, withAll]);
    });

    it('ordena por fecha, después jornada e id', async () => {
      const same = T0 + 5;
      const list = [makeFixture(9, { scheduledAt: same }), makeFixture(3, { scheduledAt: same, id: 'b' }), makeFixture(3, { scheduledAt: same, id: 'a' }), makeFixture(1, { scheduledAt: T0 })];
      await repo.replaceFixtures(TEAM_ID, list);
      expect((await repo.listFixtures(TEAM_ID)).map((f) => f.id)).toEqual(['fixture-1', 'a', 'b', 'fixture-9']);
    });

    it('replaceFixtures sustituye todo lo del equipo y no toca el de otro equipo', async () => {
      const other = makeFixture(1, { id: 'otro-1', teamId: OTHER_TEAM_ID });
      await repo.replaceFixtures(OTHER_TEAM_ID, [other]);
      await repo.replaceFixtures(TEAM_ID, [makeFixture(1), makeFixture(2), makeFixture(3)]);
      await repo.replaceFixtures(TEAM_ID, [makeFixture(4, { id: 'nuevo' })]);
      expect((await repo.listFixtures(TEAM_ID)).map((f) => f.id)).toEqual(['nuevo']);
      expect(await repo.listFixtures(OTHER_TEAM_ID)).toEqual([other]);
      await repo.replaceFixtures(TEAM_ID, []);
      expect(await repo.listFixtures(TEAM_ID)).toEqual([]);
      expect(await repo.listFixtures(OTHER_TEAM_ID)).toEqual([other]);
    });

    it('si una fila no se puede guardar (de otro equipo, id repetido), rechaza con STORAGE y deja el calendario anterior', async () => {
      const before = [makeFixture(1), makeFixture(2)];
      await repo.replaceFixtures(TEAM_ID, before);

      expect((await fixtureRepositoryError(repo.replaceFixtures(TEAM_ID, [makeFixture(3), makeFixture(4, { teamId: OTHER_TEAM_ID })]))).code).toBe('STORAGE');
      expect(await repo.listFixtures(TEAM_ID)).toEqual(before);

      expect((await fixtureRepositoryError(repo.replaceFixtures(TEAM_ID, [makeFixture(3), makeFixture(4, { id: 'fixture-3' })]))).code).toBe('STORAGE');
      expect(await repo.listFixtures(TEAM_ID)).toEqual(before);
    });

    it('linkMatch vincula y desvincula un partido jugado y actualiza updatedAt sin tocar el resto', async () => {
      await harness.matches.createMatch(makeMatch(1), []);
      const original = makeFixture(1);
      await repo.replaceFixtures(TEAM_ID, [original, makeFixture(2)]);

      await repo.linkMatch('fixture-1', 'match-1', T0 + 50);
      expect((await repo.listFixtures(TEAM_ID))[0]).toEqual({ ...original, matchId: 'match-1', updatedAt: T0 + 50 });
      expect((await repo.listFixtures(TEAM_ID))[1]?.matchId).toBeNull();

      await repo.linkMatch('fixture-1', null, T0 + 60);
      expect((await repo.listFixtures(TEAM_ID))[0]).toEqual({ ...original, updatedAt: T0 + 60 });
    });

    it('linkMatch de un partido inexistente rechaza con NOT_FOUND', async () => {
      expect((await fixtureRepositoryError(repo.linkMatch('nadie', null, T0))).code).toBe('NOT_FOUND');
    });

    it('devuelve copias: modificar lo devuelto no altera lo guardado', async () => {
      await repo.replaceFixtures(TEAM_ID, [makeFixture(1)]);
      (await repo.listFixtures(TEAM_ID))[0]!.opponent = 'CAMBIADO';
      expect((await repo.listFixtures(TEAM_ID))[0]?.opponent).toBe('RIVAL 1');
    });
  });
}
