import { createInMemoryEventStore } from '../../../db/inMemoryEventStore';
import { createInMemoryFixtureRepository } from '../../../db/inMemoryFixtureRepository';
import { createInMemoryMatchRepository } from '../../../db/inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../../../db/inMemorySquadRepository';
import { ImportCalendarError, importCalendar } from '../importCalendar';
import type { Persistence } from '../persistence';

/** Calendario inventado en la "versión resumida" (celdas con tabuladores). */
const OWN = 'C.D. EJEMPLO "A"';
const T0 = new Date(2030, 8, 1, 12, 0).getTime();
const TEXT = [
  '3ª Liga Inventada Benjamín, Grupo 9',
  'Temporada 2030-2031',
  'Jornada 1 (20-09-2030)',
  'UD NORTE\t    \tC.D. EJEMPLO "A"',
  'CLUB OTRO\t    \tATLETICO SUR',
  'Jornada 2 (27-09-2030)',
  'C.D. EJEMPLO "A"\t    \tCLUB OTRO',
  'Jornada 3 (04-10-2030)',
  'ATLETICO SUR\t    \tC.D. EJEMPLO "A"',
].join('\n');

function makePersistence(): Persistence {
  return { squad: createInMemorySquadRepository(), matches: createInMemoryMatchRepository(), fixtures: createInMemoryFixtureRepository(), events: createInMemoryEventStore() };
}

const failure = async (promise: Promise<unknown>): Promise<ImportCalendarError> => {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImportCalendarError);
  return error as ImportCalendarError;
};

describe('importCalendar', () => {
  const team = { id: 'team-1', federationName: OWN };
  let n = 0;
  const newId = () => `fx-${++n}`;

  beforeEach(() => {
    n = 0;
  });

  it('guarda los partidos del equipo con competición y temporada y devuelve el resumen', async () => {
    const persistence = makePersistence();
    const result = await importCalendar({ persistence, team, text: TEXT, now: () => T0, newId });
    expect(result).toMatchObject({ count: 3, competition: '3ª Liga Inventada Benjamín, Grupo 9', season: '2030-2031' });

    const saved = await persistence.fixtures.listFixtures('team-1');
    expect(saved.map((f) => [f.matchday, f.opponent, f.homeAway, f.matchId])).toEqual([
      [1, 'UD NORTE', 'AWAY', null],
      [2, 'CLUB OTRO', 'HOME', null],
      [3, 'ATLETICO SUR', 'AWAY', null],
    ]);
    expect(saved[0]).toMatchObject({ competition: '3ª Liga Inventada Benjamín, Grupo 9', season: '2030-2031', createdAt: T0, hasTime: false });
  });

  it('reimportar sustituye el calendario y conserva el vínculo de lo ya jugado', async () => {
    const persistence = makePersistence();
    await importCalendar({ persistence, team, text: TEXT, now: () => T0, newId });
    const [first] = await persistence.fixtures.listFixtures('team-1');
    await persistence.fixtures.linkMatch(first!.id, 'match-1', T0 + 5);

    const changed = TEXT.replace('Jornada 2 (27-09-2030)', 'Jornada 2 (28-09-2030)').replace('CLUB OTRO\t    \tATLETICO SUR', 'CLUB OTRO\t    \tATLETICO SUR');
    const result = await importCalendar({ persistence, team, text: changed, now: () => T0 + 100, newId });
    expect(result.count).toBe(3);

    const saved = await persistence.fixtures.listFixtures('team-1');
    expect(saved).toHaveLength(3);
    expect(saved[0]).toMatchObject({ id: first!.id, matchId: 'match-1', createdAt: T0 });
    expect(saved[1]).toMatchObject({ matchday: 2, matchId: null, createdAt: T0 + 100 });
    expect(saved[1]?.matchdayDate).toBe(new Date(2030, 8, 28).getTime());
  });

  it('sin nombre en la federación rechaza con NO_FEDERATION_NAME y no guarda nada', async () => {
    const persistence = makePersistence();
    const error = await failure(importCalendar({ persistence, team: { id: 'team-1', federationName: null }, text: TEXT, now: () => T0 }));
    expect(error.code).toBe('NO_FEDERATION_NAME');
    expect(await persistence.fixtures.listFixtures('team-1')).toEqual([]);
  });

  it('un texto sin partidos del equipo rechaza con NO_MATCHES y NO borra el calendario guardado', async () => {
    const persistence = makePersistence();
    await importCalendar({ persistence, team, text: TEXT, now: () => T0, newId });
    for (const bad of ['', 'cualquier cosa', TEXT.replace(/C\.D\. EJEMPLO "A"/g, 'OTRO CLUB')]) {
      expect((await failure(importCalendar({ persistence, team, text: bad, now: () => T0 + 1, newId }))).code).toBe('NO_MATCHES');
    }
    expect(await persistence.fixtures.listFixtures('team-1')).toHaveLength(3);
  });

  it('si el repositorio falla, el error se propaga y lo guardado queda como estaba', async () => {
    const persistence = makePersistence();
    await importCalendar({ persistence, team, text: TEXT, now: () => T0, newId });
    jest.spyOn(persistence.fixtures, 'replaceFixtures').mockRejectedValueOnce(new Error('disco lleno'));
    await expect(importCalendar({ persistence, team, text: TEXT, now: () => T0 + 1, newId })).rejects.toThrow('disco lleno');
    expect((await persistence.fixtures.listFixtures('team-1'))[0]?.createdAt).toBe(T0);
  });
});
