import { createFakeStorage } from '../../../db/__tests__/fakeStorage';
import { makeEvent } from '../../../db/__tests__/fixtures';
import { makeMatch, makeMatchPlayer } from '../../../db/__tests__/matchRepositoryContract';
import { makePlayer, makeTeam } from '../../../db/__tests__/squadRepositoryContract';
import { openPersistence, webStorage } from '../openPersistence.web';

/** La variante web con un localStorage falso en `globalThis`: todo sobrevive a "recargar" (abrir otra vez). */
const globals = globalThis as { localStorage?: unknown };
const original = Object.getOwnPropertyDescriptor(globals, 'localStorage');

afterEach(() => {
  if (original) Object.defineProperty(globals, 'localStorage', original);
  else delete globals.localStorage;
});

const install = (value: unknown) => Object.defineProperty(globals, 'localStorage', { value, configurable: true, writable: true });

describe('openPersistence (web)', () => {
  it('con localStorage, plantilla, partidos y timeline sobreviven a abrir la persistencia otra vez', async () => {
    const storage = createFakeStorage();
    install(storage);
    const first = await openPersistence();
    await first.squad.saveTeam(makeTeam());
    await first.squad.savePlayers([makePlayer(1)]);
    await first.matches.createMatch(makeMatch(1, { status: 'RUNNING', currentPeriod: 1, startedAt: 1 }), [makeMatchPlayer('match-1', 1)]);
    await first.events.append(makeEvent(1, { matchId: 'match-1' }));

    const second = await openPersistence();
    expect(await second.squad.getTeam()).toEqual(makeTeam());
    expect((await second.matches.findInProgressMatch())?.id).toBe('match-1');
    expect(await second.matches.listMatchPlayers('match-1')).toEqual([makeMatchPlayer('match-1', 1)]);
    expect((await second.events.loadEvents('match-1')).map((e) => e.seq)).toEqual([1]);
  });

  it('sin localStorage (o con el acceso bloqueado) funciona solo en memoria', async () => {
    delete globals.localStorage;
    expect(webStorage()).toBeNull();
    const memory = await openPersistence();
    await memory.matches.createMatch(makeMatch(1), []);
    expect(await memory.matches.getMatch('match-1')).not.toBeNull();

    Object.defineProperty(globals, 'localStorage', {
      get() {
        throw new Error('bloqueado');
      },
      configurable: true,
    });
    expect(webStorage()).toBeNull();
    const blocked = await openPersistence();
    await blocked.events.append(makeEvent(1));
    expect(await blocked.events.lastSeq('match-f7-1')).toBe(1);
  });
});
