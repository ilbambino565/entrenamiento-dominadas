import { createDemoSession, prepareMatch } from '../createDemoSession';
import { GOALKEEPER_SLOT, formationSlots } from '../formations';
import { packLineup, parseTeamPack, readTeamPack } from '../teamPack';

const PACK = {
  teamName: 'A.D. Prueba',
  players: [
    { id: 'ana', name: 'Ana', number: 1, isGoalkeeper: true, photoUri: 'data:image/jpeg;base64,AAAA' },
    { id: 'bea', name: 'Bea', number: 2 },
    { id: 'cris', name: 'Cris', number: 3 },
    { id: 'dani', name: 'Dani', number: 4 },
    { id: 'eva', name: 'Eva', number: 5 },
    { id: 'fani', name: 'Fani', number: 6 },
    { id: 'gala', name: 'Gala', number: 7 },
    { id: 'hilda', name: 'Hilda', number: 8 },
    { id: 'ines', name: 'Inés', number: 9 },
  ],
  starters: ['bea', 'cris', 'ana', 'dani', 'eva', 'fani', 'gala'],
};

describe('paquete de equipo', () => {
  afterEach(() => {
    delete (globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__;
  });

  it('parsea un paquete válido y descarta jugadores sin id o nombre', () => {
    const pack = parseTeamPack({ ...PACK, players: [...PACK.players, { name: 'sin id' }, { id: 'x' }, 'basura'] });
    expect(pack?.teamName).toBe('A.D. Prueba');
    expect(pack?.players.map((p) => p.id)).toEqual(PACK.players.map((p) => p.id));
    expect(pack?.players[0]).toEqual({ id: 'ana', name: 'Ana', number: 1, isGoalkeeper: true, photoUri: 'data:image/jpeg;base64,AAAA' });
    expect(pack?.starters).toEqual(PACK.starters);
  });

  it('rechaza lo que no es un paquete (null, sin jugadores, ids repetidos)', () => {
    expect(parseTeamPack(null)).toBeNull();
    expect(parseTeamPack({ players: [] })).toBeNull();
    expect(parseTeamPack({ players: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })).toBeNull();
    expect(parseTeamPack({ players: [{ id: 'a', name: 'A' }] })?.teamName).toBe('Mi equipo');
    expect(parseTeamPack({ players: [{ id: 'a', name: 'A' }], starters: ['zz', 'a'] })?.starters).toEqual(['a']);
    expect(readTeamPack()).toBeNull();
  });

  it('packLineup coloca al portero en su área y al resto en 2-3-1; los demás al banquillo', () => {
    const { lineup, bench } = packLineup(parseTeamPack(PACK)!, 7);
    expect(lineup[0]).toEqual({ playerId: 'ana', position: GOALKEEPER_SLOT, goalkeeper: true });
    expect(lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    expect(lineup.slice(1).map((e) => e.playerId)).toEqual(['bea', 'cris', 'dani', 'eva', 'fani', 'gala']);
    expect(bench).toEqual(['hilda', 'ines']);
  });

  it('sin portero declarado, el último titular ocupa el hueco de la portería sin la marca', () => {
    const noKeeper = parseTeamPack({ ...PACK, players: PACK.players.map(({ isGoalkeeper: _gk, ...p }) => p), starters: undefined })!;
    const { lineup, bench } = packLineup(noKeeper, 7);
    expect(lineup).toHaveLength(7);
    expect(lineup.every((e) => !e.goalkeeper)).toBe(true);
    expect(lineup[6]).toEqual({ playerId: 'gala', position: GOALKEEPER_SLOT });
    expect(bench).toEqual(['hilda', 'ines']);
  });

  it('createDemoSession usa el paquete global si existe y el equipo de prueba si no', async () => {
    (globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__ = PACK;
    const real = createDemoSession();
    expect(real.teamName).toBe('A.D. Prueba');
    expect(Object.keys(real.players)).toHaveLength(9);
    await prepareMatch(real.session, real.lineup, real.bench);
    const state = real.session.engine.getState();
    expect(state.status).toBe('READY');
    expect(state.players.ana).toMatchObject({ location: 'FIELD', isGoalkeeper: true });
    expect(state.players.ines?.location).toBe('BENCH');

    const demo = createDemoSession({ pack: null });
    expect(demo.teamName).toBe('Equipo de prueba');
    expect(Object.keys(demo.players)).toHaveLength(10);
  });
});
