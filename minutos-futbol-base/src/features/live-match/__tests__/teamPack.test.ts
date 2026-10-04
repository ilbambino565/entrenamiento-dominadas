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
    // Repetidos: se queda la primera aparición (si no, el motor rechaza la alineación entera).
    expect(parseTeamPack({ ...PACK, starters: ['ana', 'bea', 'bea', 'cris', 'ana'] })?.starters).toEqual(['ana', 'bea', 'cris']);
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

  it('acepta un dibujo propio y coloca a los titulares por filas: defensa (izquierda→derecha), medio, ataque', () => {
    const pack = parseTeamPack({ ...PACK, formation: '3-1-2', starters: ['ana', 'bea', 'cris', 'dani', 'eva', 'fani', 'gala'] })!;
    expect(pack.formation).toBe('3-1-2');
    const { lineup, bench } = packLineup(pack, 7);
    expect(lineup[0]).toEqual({ playerId: 'ana', position: GOALKEEPER_SLOT, goalkeeper: true });
    expect(lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('3-1-2'));
    const pos = (id: string) => lineup.find((e) => e.playerId === id)!.position;
    // Defensa: bea izquierda, cris centro, dani derecha (x creciente, misma y); eva mediocentro; fani y gala arriba.
    expect(pos('bea').x).toBeLessThan(pos('cris').x);
    expect(pos('cris').x).toBeLessThan(pos('dani').x);
    expect(pos('bea').y).toBe(pos('dani').y);
    expect(pos('eva').x).toBe(0.5);
    expect(pos('eva').y).toBeLessThan(pos('cris').y);
    expect(pos('fani').y).toBeLessThan(pos('eva').y);
    expect(pos('fani').x).toBeLessThan(pos('gala').x);
    expect(bench).toEqual(['hilda', 'ines']);
  });

  it('un dibujo que no es tal, o que no cuadra con el formato, se ignora y se usa el de referencia', () => {
    expect(parseTeamPack({ ...PACK, formation: 'tres' })?.formation).toBeUndefined();
    expect(parseTeamPack({ ...PACK, formation: 42 })?.formation).toBeUndefined();
    expect(parseTeamPack({ ...PACK, formation: '' })?.formation).toBeUndefined();
    const eight = parseTeamPack({ ...PACK, formation: '3-3-1' })!; // vale para F8, no para F7
    expect(eight.formation).toBe('3-3-1');
    expect(packLineup(eight, 7).lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    const eightStarters = parseTeamPack({ ...PACK, formation: '3-3-1', starters: [...PACK.starters, 'hilda'] })!;
    expect(packLineup(eightStarters, 8).lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('3-3-1'));
    // Dibujo CORTO ('3-1-1', un dedo que resbala): también se ignora; nadie de campo cae sobre el portero.
    const short = packLineup(parseTeamPack({ ...PACK, formation: '3-1-1' })!, 7).lineup;
    expect(short.slice(1).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    expect(short.filter((e) => e.position.x === GOALKEEPER_SLOT.x && e.position.y === GOALKEEPER_SLOT.y)).toHaveLength(1);
  });

  it('un paquete con titulares repetidos sigue cargando el partido con los siete en el campo', async () => {
    const pack = parseTeamPack({ ...PACK, formation: '3-1-2', starters: ['ana', 'bea', 'bea', 'cris', 'dani', 'eva', 'fani', 'gala'] })!;
    const real = createDemoSession({ pack });
    await prepareMatch(real.session, real.lineup, real.bench);
    const state = real.session.engine.getState();
    expect(state.status).toBe('READY');
    expect(Object.values(state.players).filter((p) => p.location === 'FIELD').map((p) => p.playerId).sort()).toEqual(
      ['ana', 'bea', 'cris', 'dani', 'eva', 'fani', 'gala'],
    );
  });

  it('el camino real (__TEAM_PACK__ → createDemoSession → prepareMatch) respeta el dibujo y el orden por filas en el motor', async () => {
    (globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__ = { ...PACK, formation: '3-1-2', starters: ['ana', 'bea', 'cris', 'dani', 'eva', 'fani', 'gala'] };
    const real = createDemoSession();
    await prepareMatch(real.session, real.lineup, real.bench);
    const players = real.session.engine.getState().players;
    expect(players.ana?.position).toEqual(GOALKEEPER_SLOT);
    expect(['bea', 'cris', 'dani', 'eva', 'fani', 'gala'].map((id) => players[id]?.position)).toEqual(formationSlots('3-1-2'));
    // bea: lateral izquierdo (x pequeña, fila de la defensa); gala: delantera derecha.
    expect(players.bea?.position).toEqual({ x: 0.2, y: 0.7 });
    expect(players.gala?.position).toEqual({ x: 0.65, y: 0.22 });
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
