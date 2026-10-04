import { createMatchSession } from '../../../app-services/createMatchSession';
import type { Match } from '../../../core/match';
import { createInMemoryEventStore } from '../../../db/inMemoryEventStore';
import { createInMemoryMatchRepository } from '../../../db/inMemoryMatchRepository';
import { trackMatchProgress } from '../trackMatchProgress';

/** El seguimiento con el motor real: nombres inventados, reloj controlado a mano. */
const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const SQUAD = ['p1', 'p2', 'p3'];

const match: Match = {
  id: 'match-1',
  teamId: 'team-1',
  opponent: 'CD Rival',
  scheduledAt: T0,
  format: 'F7',
  playersOnField: 7,
  periodsCount: 2,
  periodDurationMs: 25 * MINUTE,
  homeAway: null,
  competition: null,
  matchday: null,
  status: 'DRAFT',
  currentPeriod: 0,
  startedAt: null,
  finishedAt: null,
  createdAt: T0,
  updatedAt: T0,
};

async function setup() {
  let clock = T0;
  const repo = createInMemoryMatchRepository();
  await repo.createMatch(match, []);
  const session = createMatchSession({
    config: { matchId: match.id, playersOnField: 7, periodsCount: 2, periodDurationMs: 25 * MINUTE, squad: SQUAD },
    store: createInMemoryEventStore(),
    cameraSettings: null,
    now: () => clock,
  });
  const tracker = trackMatchProgress(session.engine, repo, match.id, match, () => clock);
  await session.engine.load();
  const at = (ms: number) => {
    clock = T0 + ms;
    return clock;
  };
  return { repo, session, tracker, at };
}

describe('trackMatchProgress', () => {
  it('guarda cada cambio de estado, el inicio y, al terminar, la hora de fin', async () => {
    const { repo, session, tracker, at } = await setup();
    const { engine } = session;

    await engine.setLineup([{ playerId: 'p1', position: { x: 0.5, y: 0.9 }, goalkeeper: true }], ['p2', 'p3'], at(1000));
    await tracker.stop();
    expect(await repo.getMatch(match.id)).toMatchObject({ status: 'READY', currentPeriod: 0, startedAt: null, finishedAt: null });
  });

  it('un partido completo queda FINISHED con inicio y fin, y stop() espera lo pendiente', async () => {
    const { repo, session, tracker, at } = await setup();
    const { engine } = session;

    await engine.setLineup([{ playerId: 'p1', position: { x: 0.5, y: 0.9 }, goalkeeper: true }], ['p2', 'p3'], at(1000));
    await engine.start(at(2000));
    await engine.startHalftime(at(2000 + 25 * MINUTE));
    await engine.startNextPeriod(at(2000 + 30 * MINUTE));
    await engine.end('NORMAL', at(2000 + 55 * MINUTE));
    await tracker.stop();

    expect(await repo.getMatch(match.id)).toMatchObject({
      status: 'FINISHED',
      currentPeriod: 2,
      startedAt: T0 + 2000,
      finishedAt: T0 + 2000 + 55 * MINUTE,
      updatedAt: T0 + 2000 + 55 * MINUTE,
    });
  });

  it('un fallo al guardar no interrumpe el partido y el siguiente cambio guarda el estado completo', async () => {
    const { repo, session, tracker, at } = await setup();
    const { engine } = session;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(repo, 'saveProgress').mockRejectedValueOnce(new Error('disco lleno'));

    await engine.setLineup([{ playerId: 'p1', position: { x: 0.5, y: 0.9 }, goalkeeper: true }], ['p2', 'p3'], at(1000));
    await engine.start(at(2000));
    await tracker.stop();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(await repo.getMatch(match.id)).toMatchObject({ status: 'RUNNING', currentPeriod: 1, startedAt: T0 + 2000 });
    warn.mockRestore();
  });

  it('tras stop() ya no escucha', async () => {
    const { repo, session, tracker, at } = await setup();
    await tracker.stop();
    await session.engine.setLineup([{ playerId: 'p1', position: { x: 0.5, y: 0.9 }, goalkeeper: true }], ['p2', 'p3'], at(1000));
    expect((await repo.getMatch(match.id))?.status).toBe('DRAFT');
  });
});
