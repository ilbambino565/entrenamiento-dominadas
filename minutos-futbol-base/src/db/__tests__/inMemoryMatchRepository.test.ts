import { createInMemoryMatchRepository } from '../inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../inMemorySquadRepository';
import { describeMatchRepositoryContract, makeMatch, matchRepositoryError } from './matchRepositoryContract';

describeMatchRepositoryContract('InMemoryMatchRepository', () => ({
  matches: createInMemoryMatchRepository(),
  squad: createInMemorySquadRepository(),
}));

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
