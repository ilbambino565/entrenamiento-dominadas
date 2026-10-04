import { fixturesFromCalendar, mergeImportedFixtures, upcomingFixtures, type Fixture } from '../fixture';
import type { RfafCalendar } from '../rfafCalendar';

/** Clubes y fechas inventados. */
const T0 = new Date(2030, 9, 4, 12, 0).getTime();
const day = (d: number, m: number, y: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

const calendar: RfafCalendar = {
  competition: '3ª Liga Inventada Benjamín, Grupo 9',
  season: '2030-2031',
  fixtures: [
    { matchday: 1, matchdayDate: day(20, 9, 2030), opponent: 'UD NORTE', homeAway: 'HOME', venue: null, scheduledAt: day(20, 9, 2030), hasTime: false },
    { matchday: 2, matchdayDate: day(27, 9, 2030), opponent: 'CLUB OTRO', homeAway: 'AWAY', venue: 'Ciudad - Campo (A)', scheduledAt: day(26, 9, 2030, 10, 30), hasTime: true },
  ],
};

const makeFixture = (matchday: number, overrides: Partial<Fixture> = {}): Fixture => ({
  id: `fx-${matchday}`,
  teamId: 'team-1',
  matchday,
  matchdayDate: day(matchday, 10, 2030),
  opponent: `RIVAL ${matchday}`,
  homeAway: 'HOME',
  venue: null,
  scheduledAt: day(matchday, 10, 2030),
  hasTime: false,
  competition: null,
  season: null,
  matchId: null,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

describe('fixturesFromCalendar', () => {
  it('convierte los partidos leídos en filas del equipo con competición, temporada e ids nuevos, sin vínculo', () => {
    let n = 0;
    const fixtures = fixturesFromCalendar(calendar, 'team-1', () => `id-${++n}`, T0);
    expect(fixtures).toEqual([
      { id: 'id-1', teamId: 'team-1', matchday: 1, matchdayDate: day(20, 9, 2030), opponent: 'UD NORTE', homeAway: 'HOME', venue: null, scheduledAt: day(20, 9, 2030), hasTime: false, competition: '3ª Liga Inventada Benjamín, Grupo 9', season: '2030-2031', matchId: null, createdAt: T0, updatedAt: T0 },
      { id: 'id-2', teamId: 'team-1', matchday: 2, matchdayDate: day(27, 9, 2030), opponent: 'CLUB OTRO', homeAway: 'AWAY', venue: 'Ciudad - Campo (A)', scheduledAt: day(26, 9, 2030, 10, 30), hasTime: true, competition: '3ª Liga Inventada Benjamín, Grupo 9', season: '2030-2031', matchId: null, createdAt: T0, updatedAt: T0 },
    ]);
  });
});

describe('mergeImportedFixtures', () => {
  it('un partido ya jugado conserva su vínculo, id y creación al reimportar; los demás son los nuevos', () => {
    const existing = [makeFixture(1, { matchId: 'match-9', createdAt: T0 - 5 }), makeFixture(2)];
    const incoming = [makeFixture(1, { id: 'nuevo-1', opponent: 'RIVAL 1 CAMBIADO', createdAt: T0 + 1 }), makeFixture(2, { id: 'nuevo-2', opponent: 'OTRO' }), makeFixture(3, { id: 'nuevo-3' })];
    expect(mergeImportedFixtures(existing, incoming)).toEqual([
      { ...incoming[0], id: 'fx-1', createdAt: T0 - 5, matchId: 'match-9' },
      incoming[1],
      incoming[2],
    ]);
  });

  it('sin calendario anterior, o sin partidos jugados, devuelve lo importado tal cual', () => {
    const incoming = [makeFixture(1), makeFixture(2)];
    expect(mergeImportedFixtures([], incoming)).toEqual(incoming);
    expect(mergeImportedFixtures([makeFixture(1), makeFixture(2)], incoming)).toEqual(incoming);
  });

  it('una jornada que desaparece del calendario nuevo no reaparece', () => {
    expect(mergeImportedFixtures([makeFixture(1, { matchId: 'match-1' }), makeFixture(7, { matchId: 'match-7' })], [makeFixture(1, { id: 'n1' })]).map((f) => f.matchday)).toEqual([1]);
  });
});

describe('upcomingFixtures', () => {
  const now = day(4, 10, 2030, 18, 0);

  it('deja los sin jugar de hoy en adelante, por fecha y jornada, y respeta el límite', () => {
    const fixtures = [
      makeFixture(1, { scheduledAt: day(20, 9, 2030) }),
      makeFixture(4, { scheduledAt: day(11, 10, 2030) }),
      makeFixture(3, { scheduledAt: day(4, 10, 2030) }),
      makeFixture(5, { scheduledAt: day(11, 10, 2030) }),
      makeFixture(6, { scheduledAt: day(18, 10, 2030) }),
    ];
    expect(upcomingFixtures(fixtures, now).map((f) => f.matchday)).toEqual([3, 4, 5, 6]);
    expect(upcomingFixtures(fixtures, now, 2).map((f) => f.matchday)).toEqual([3, 4]);
  });

  it('el partido de hoy sigue saliendo aunque su hora ya haya pasado, y los jugados no salen', () => {
    const fixtures = [makeFixture(3, { scheduledAt: day(4, 10, 2030, 9, 0), hasTime: true }), makeFixture(4, { scheduledAt: day(11, 10, 2030), matchId: 'match-4' })];
    expect(upcomingFixtures(fixtures, now).map((f) => f.matchday)).toEqual([3]);
  });

  it('sin partidos futuros devuelve la lista vacía y no modifica la entrada', () => {
    const fixtures = [makeFixture(1, { scheduledAt: day(20, 9, 2030) })];
    expect(upcomingFixtures(fixtures, now)).toEqual([]);
    expect(fixtures).toHaveLength(1);
    expect(upcomingFixtures([], now)).toEqual([]);
  });
});
