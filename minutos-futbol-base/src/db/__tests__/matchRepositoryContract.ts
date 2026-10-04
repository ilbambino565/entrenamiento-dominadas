import type { Match, MatchPlayer } from '../../core/match';
import { MatchRepositoryError, type MatchRepository } from '../matchRepository';
import type { SquadRepository } from '../squadRepository';
import { T0 } from './fixtures';
import { TEAM_ID, makePlayer, makeTeam } from './squadRepositoryContract';

/**
 * Batería del contrato `MatchRepository`. Toda implementación (memoria,
 * SQLite) la ejecuta entera. La fábrica devuelve también el repositorio de
 * plantilla de la misma base, porque SQLite exige que equipo y jugadores
 * existan antes de crear un partido (claves foráneas).
 *
 * Rivales y jugadores inventados: el repositorio es público.
 */

export interface MatchRepositoryHarness {
  matches: MatchRepository;
  squad: SquadRepository;
}

export function makeMatch(n: number, overrides: Partial<Match> = {}): Match {
  return {
    id: `match-${n}`,
    teamId: TEAM_ID,
    opponent: `Rival ${n}`,
    scheduledAt: T0 + n * 86_400_000,
    format: 'F7',
    playersOnField: 7,
    periodsCount: 2,
    periodDurationMs: 25 * 60_000,
    homeAway: null,
    competition: null,
    matchday: null,
    status: 'DRAFT',
    currentPeriod: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: T0 + n,
    updatedAt: T0 + n,
    ...overrides,
  };
}

export function makeMatchPlayer(matchId: string, n: number, overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    id: `${matchId}:mp-${n}`,
    matchId,
    playerId: `player-${n}`,
    shirtNumber: n,
    isGoalkeeper: n === 1,
    inInitialLineup: n <= 7,
    benchOrder: n <= 7 ? null : n - 7,
    ...overrides,
  };
}

export async function matchRepositoryError(promise: Promise<unknown>): Promise<MatchRepositoryError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MatchRepositoryError);
  return error as MatchRepositoryError;
}

export function describeMatchRepositoryContract(
  name: string,
  factory: () => Promise<MatchRepositoryHarness> | MatchRepositoryHarness,
): void {
  describe(`${name}: contrato MatchRepository`, () => {
    let repo: MatchRepository;

    beforeEach(async () => {
      const harness = await factory();
      repo = harness.matches;
      await harness.squad.saveTeam(makeTeam());
      await harness.squad.savePlayers(Array.from({ length: 9 }, (_, i) => makePlayer(i + 1)));
    });

    it('al principio no hay partidos', async () => {
      expect(await repo.getMatch('match-1')).toBeNull();
      expect(await repo.listRecentMatches()).toEqual([]);
      expect(await repo.listMatchPlayers('match-1')).toEqual([]);
    });

    it('guarda y devuelve el partido idéntico, con los opcionales a null o con valor', async () => {
      const minimal = makeMatch(1);
      await repo.createMatch(minimal, []);
      expect(await repo.getMatch('match-1')).toEqual(minimal);

      const full = makeMatch(2, {
        format: 'F8',
        playersOnField: 8,
        periodsCount: 4,
        periodDurationMs: 12.5 * 60_000,
        homeAway: 'AWAY',
        competition: 'Liga ⚽ Prueba',
        matchday: 'Jornada 3',
        status: 'PAUSED',
        currentPeriod: 2,
        startedAt: T0 + 5,
        finishedAt: null,
      });
      await repo.createMatch(full, []);
      expect(await repo.getMatch('match-2')).toEqual(full);
    });

    it('guarda la convocatoria en su orden y la devuelve idéntica', async () => {
      await repo.createMatch(makeMatch(1), []);
      const squad = Array.from({ length: 9 }, (_, i) => makeMatchPlayer('match-2', i + 1));
      await repo.createMatch(makeMatch(2), squad);
      expect(await repo.listMatchPlayers('match-2')).toEqual(squad);
      expect(await repo.listMatchPlayers('match-1')).toEqual([]);
    });

    it('un dorsal o un banquillo ausentes se guardan como null', async () => {
      const convocated = makeMatchPlayer('match-1', 3, { shirtNumber: null, benchOrder: null, inInitialLineup: false });
      await repo.createMatch(makeMatch(1), [convocated]);
      expect(await repo.listMatchPlayers('match-1')).toEqual([convocated]);
    });

    it('lista los recientes por fecha descendente, con createdAt e id como desempate, y respeta el límite', async () => {
      await repo.createMatch(makeMatch(1), []);
      await repo.createMatch(makeMatch(3), []);
      await repo.createMatch(makeMatch(2), []);
      await repo.createMatch(makeMatch(4, { scheduledAt: makeMatch(3).scheduledAt, createdAt: T0 + 100 }), []);
      await repo.createMatch(makeMatch(5, { scheduledAt: makeMatch(3).scheduledAt, createdAt: T0 + 100 }), []);

      expect((await repo.listRecentMatches()).map((m) => m.id)).toEqual(['match-4', 'match-5', 'match-3', 'match-2', 'match-1']);
      expect((await repo.listRecentMatches(2)).map((m) => m.id)).toEqual(['match-4', 'match-5']);
    });

    it('un id repetido rechaza con STORAGE y no cambia nada', async () => {
      const original = makeMatch(1);
      const squad = [makeMatchPlayer('match-1', 1)];
      await repo.createMatch(original, squad);

      const error = await matchRepositoryError(
        repo.createMatch(makeMatch(1, { opponent: 'Otro' }), [makeMatchPlayer('match-1', 2)]),
      );
      expect(error.code).toBe('STORAGE');
      expect(await repo.getMatch('match-1')).toEqual(original);
      expect(await repo.listMatchPlayers('match-1')).toEqual(squad);
    });

    it('un jugador convocado dos veces rechaza con STORAGE y no se guarda ni el partido', async () => {
      const error = await matchRepositoryError(
        repo.createMatch(makeMatch(1), [
          makeMatchPlayer('match-1', 1),
          makeMatchPlayer('match-1', 1, { id: 'match-1:otra-fila' }),
        ]),
      );
      expect(error.code).toBe('STORAGE');
      expect(await repo.getMatch('match-1')).toBeNull();
      expect(await repo.listMatchPlayers('match-1')).toEqual([]);
    });

    it('saveProgress actualiza estado, parte y marcas sin tocar el resto, y finalizar queda guardado', async () => {
      const original = makeMatch(1);
      await repo.createMatch(original, []);

      await repo.saveProgress('match-1', { status: 'RUNNING', currentPeriod: 1, startedAt: T0 + 10, finishedAt: null, updatedAt: T0 + 10 });
      expect(await repo.getMatch('match-1')).toEqual({
        ...original,
        status: 'RUNNING',
        currentPeriod: 1,
        startedAt: T0 + 10,
        updatedAt: T0 + 10,
      });

      await repo.saveProgress('match-1', { status: 'FINISHED', currentPeriod: 2, startedAt: T0 + 10, finishedAt: T0 + 99, updatedAt: T0 + 99 });
      expect(await repo.getMatch('match-1')).toEqual({
        ...original,
        status: 'FINISHED',
        currentPeriod: 2,
        startedAt: T0 + 10,
        finishedAt: T0 + 99,
        updatedAt: T0 + 99,
      });
    });

    it('saveProgress de un partido inexistente rechaza con NOT_FOUND', async () => {
      const error = await matchRepositoryError(
        repo.saveProgress('nadie', { status: 'READY', currentPeriod: 0, startedAt: null, finishedAt: null, updatedAt: T0 }),
      );
      expect(error.code).toBe('NOT_FOUND');
    });

    it('devuelve copias: modificar lo devuelto no altera lo guardado', async () => {
      await repo.createMatch(makeMatch(1), [makeMatchPlayer('match-1', 1)]);
      const match = (await repo.getMatch('match-1'))!;
      match.opponent = 'Cambiado';
      (await repo.listRecentMatches())[0]!.opponent = 'Cambiado';
      (await repo.listMatchPlayers('match-1'))[0]!.shirtNumber = 99;

      expect((await repo.getMatch('match-1'))!.opponent).toBe('Rival 1');
      expect((await repo.listMatchPlayers('match-1'))[0]!.shirtNumber).toBe(1);
    });
  });
}
