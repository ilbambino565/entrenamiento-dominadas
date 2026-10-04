import fc from 'fast-check';
import { GOALKEEPER_SLOT, formationSlots } from '../formations';
import {
  FIRST_NAME_MAX_LENGTH,
  LAST_NAME_MAX_LENGTH,
  activePlayers,
  anonymizePlayer,
  buildDefaultLineup,
  defaultFormationFor,
  displayName,
  hasBlockingIssues,
  movePlayerInList,
  normalizePlayerDraft,
  placeStarters,
  reorderByIds,
  sortPlayers,
  teamMatchConfig,
  toPlayerInfo,
  validatePlayerDraft,
  withSortOrders,
} from '../squad';
import type { Player, PlayerDraft } from '../team';

/**
 * Lógica pura de la plantilla. Los nombres son inventados (el repositorio es
 * público y los datos reales de los niños nunca entran aquí).
 */

const T0 = 1_700_000_000_000;
const NOW = T0 + 60_000;

function mkPlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 'team-1',
    firstName: id.charAt(0).toUpperCase() + id.slice(1),
    lastName: null,
    shirtNumber: null,
    isGoalkeeper: false,
    isActive: true,
    photoUri: null,
    photoConsent: false,
    sortOrder: 0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

/** Plantilla numerada 0..n-1 en el orden dado. */
const squad = (...ids: string[]): Player[] => ids.map((id, i) => mkPlayer(id, { sortOrder: i, createdAt: T0 + i }));

const ids = (players: readonly Player[]): string[] => players.map((p) => p.id);
const orders = (players: readonly Player[]): number[] => players.map((p) => p.sortOrder);

const draft = (overrides: Partial<PlayerDraft> = {}): PlayerDraft => ({
  firstName: 'Ana',
  lastName: null,
  shirtNumber: null,
  isGoalkeeper: false,
  isActive: true,
  photoUri: null,
  photoConsent: false,
  ...overrides,
});

describe('normalizePlayerDraft', () => {
  it('recorta espacios, apellidos vacíos → null y dorsal NaN → null', () => {
    const n = normalizePlayerDraft(draft({ firstName: '  Ana ', lastName: '   ', shirtNumber: Number.NaN }));
    expect(n.firstName).toBe('Ana');
    expect(n.lastName).toBeNull();
    expect(n.shirtNumber).toBeNull();
  });

  it('conserva apellidos y dorsal válidos y el resto de campos', () => {
    const n = normalizePlayerDraft(draft({ lastName: ' García ', shirtNumber: 7, isGoalkeeper: true, photoConsent: true }));
    expect(n).toEqual(draft({ lastName: 'García', shirtNumber: 7, isGoalkeeper: true, photoConsent: true }));
  });
});

describe('validatePlayerDraft', () => {
  it('una ficha correcta no tiene problemas', () => {
    expect(validatePlayerDraft(draft({ lastName: 'García', shirtNumber: 7 }), [])).toEqual([]);
    expect(hasBlockingIssues([])).toBe(false);
  });

  it('el nombre es obligatorio (tras recortar) y de como mucho 40 caracteres', () => {
    expect(validatePlayerDraft(draft({ firstName: '   ' }), [])).toMatchObject([{ field: 'firstName', code: 'REQUIRED', level: 'error' }]);
    expect(validatePlayerDraft(draft({ firstName: ' ' + 'a'.repeat(FIRST_NAME_MAX_LENGTH) + ' ' }), [])).toEqual([]);
    expect(validatePlayerDraft(draft({ firstName: 'a'.repeat(FIRST_NAME_MAX_LENGTH + 1) }), [])).toMatchObject([
      { field: 'firstName', code: 'TOO_LONG', level: 'error' },
    ]);
  });

  it('los apellidos admiten hasta 60 caracteres', () => {
    expect(validatePlayerDraft(draft({ lastName: 'b'.repeat(LAST_NAME_MAX_LENGTH) }), [])).toEqual([]);
    expect(validatePlayerDraft(draft({ lastName: 'b'.repeat(LAST_NAME_MAX_LENGTH + 1) }), [])).toMatchObject([
      { field: 'lastName', code: 'TOO_LONG', level: 'error' },
    ]);
  });

  it('dorsal: 1 y 99 valen; 0, 100, -1 y 7,5 no (el 0 se reserva para "sin dorsal" en la ficha del partido); NaN cuenta como vacío', () => {
    expect(validatePlayerDraft(draft({ shirtNumber: 1 }), [])).toEqual([]);
    expect(validatePlayerDraft(draft({ shirtNumber: 0 }), [])).toMatchObject([{ field: 'shirtNumber', code: 'RANGE', level: 'error' }]);
    expect(validatePlayerDraft(draft({ shirtNumber: 99 }), [])).toEqual([]);
    for (const bad of [100, -1, 7.5]) {
      const issues = validatePlayerDraft(draft({ shirtNumber: bad }), []);
      expect(issues).toMatchObject([{ field: 'shirtNumber', code: 'RANGE', level: 'error' }]);
      expect(hasBlockingIssues(issues)).toBe(true);
    }
    expect(validatePlayerDraft(draft({ shirtNumber: Number.NaN }), [])).toEqual([]);
  });

  it('dorsal repetido con otro jugador vivo es un aviso que no bloquea', () => {
    const others = [
      { id: 'bea', shirtNumber: 7, deletedAt: null },
      { id: 'cris', shirtNumber: 9, deletedAt: NOW },
    ];
    const issues = validatePlayerDraft(draft({ shirtNumber: 7 }), others);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'shirtNumber', code: 'DUPLICATE_NUMBER', level: 'warning' });
    expect(issues[0]?.message).toContain('7');
    expect(hasBlockingIssues(issues)).toBe(false);
    // Editándose a sí misma no choca consigo misma; con un eliminado tampoco.
    expect(validatePlayerDraft(draft({ shirtNumber: 7 }), others, 'bea')).toEqual([]);
    expect(validatePlayerDraft(draft({ shirtNumber: 9 }), others)).toEqual([]);
  });

  it('foto sin consentimiento es un error; con consentimiento no', () => {
    const issues = validatePlayerDraft(draft({ photoUri: 'file:///foto.jpg' }), []);
    expect(issues).toMatchObject([{ field: 'photo', code: 'PHOTO_WITHOUT_CONSENT', level: 'error' }]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(validatePlayerDraft(draft({ photoUri: 'file:///foto.jpg', photoConsent: true }), [])).toEqual([]);
  });

  it('acumula varios problemas a la vez, con texto en español', () => {
    const issues = validatePlayerDraft(draft({ firstName: '', shirtNumber: 100, photoUri: 'x' }), []);
    expect(issues.map((i) => i.code)).toEqual(['REQUIRED', 'RANGE', 'PHOTO_WITHOUT_CONSENT']);
    for (const i of issues) expect(i.message.length).toBeGreaterThan(5);
  });
});

describe('displayName', () => {
  const ana = { firstName: 'Ana', lastName: 'García López' };

  it('full = nombre y apellidos; first = solo nombre', () => {
    expect(displayName(ana, 'full')).toBe('Ana García López');
    expect(displayName(ana, 'first')).toBe('Ana');
  });

  it('first_initial = nombre e inicial del primer apellido con punto, también con apellidos compuestos', () => {
    expect(displayName(ana, 'first_initial')).toBe('Ana G.');
    expect(displayName({ firstName: 'Bea', lastName: 'de la Torre' }, 'first_initial')).toBe('Bea D.');
    expect(displayName({ firstName: 'Cris', lastName: 'Pérez-Reverte' }, 'first_initial')).toBe('Cris P.');
    expect(displayName({ firstName: 'Dani', lastName: '  Ñíguez ' }, 'first_initial')).toBe('Dani Ñ.');
  });

  it('sin apellidos (null o en blanco) los tres modos dan el nombre recortado', () => {
    for (const mode of ['full', 'first_initial', 'first'] as const) {
      expect(displayName({ firstName: ' Eva ', lastName: null }, mode)).toBe('Eva');
      expect(displayName({ firstName: 'Eva', lastName: '  ' }, mode)).toBe('Eva');
    }
  });
});

describe('sortPlayers / activePlayers', () => {
  it('ordena por sortOrder, luego createdAt y luego id, sin tocar la entrada', () => {
    const input = [
      mkPlayer('cris', { sortOrder: 1, createdAt: T0 + 5 }),
      mkPlayer('bea', { sortOrder: 1, createdAt: T0 + 5 }),
      mkPlayer('dani', { sortOrder: 1, createdAt: T0 + 1 }),
      mkPlayer('ana', { sortOrder: 0, createdAt: T0 + 9 }),
    ];
    const copy = [...input];
    expect(ids(sortPlayers(input))).toEqual(['ana', 'dani', 'bea', 'cris']);
    expect(input).toEqual(copy);
  });

  it('activePlayers deja fuera a eliminados e inactivos y ordena', () => {
    const players = [
      mkPlayer('cris', { sortOrder: 2 }),
      mkPlayer('bea', { sortOrder: 1, isActive: false }),
      mkPlayer('ana', { sortOrder: 0 }),
      mkPlayer('dani', { sortOrder: 3, deletedAt: NOW, isActive: true }),
    ];
    expect(ids(activePlayers(players))).toEqual(['ana', 'cris']);
  });
});

describe('withSortOrders', () => {
  it('renumera 0..n-1 y solo toca updatedAt de quien cambia de número', () => {
    const [ana, bea, cris] = squad('ana', 'bea', 'cris');
    const result = withSortOrders([bea!, ana!, cris!], NOW);
    expect(orders(result)).toEqual([0, 1, 2]);
    expect(result[0]).toEqual({ ...bea, sortOrder: 0, updatedAt: NOW });
    expect(result[1]).toEqual({ ...ana, sortOrder: 1, updatedAt: NOW });
    expect(result[2]).toBe(cris); // mismo objeto: ya estaba en el 2
  });
});

describe('movePlayerInList', () => {
  it('intercambia con el vecino y renumera solo a los dos', () => {
    const players = squad('ana', 'bea', 'cris', 'dani');
    const down = movePlayerInList(players, 'bea', 1, NOW);
    expect(ids(down)).toEqual(['ana', 'cris', 'bea', 'dani']);
    expect(orders(down)).toEqual([0, 1, 2, 3]);
    expect(down.map((p) => p.updatedAt)).toEqual([T0, NOW, NOW, T0]);
    const up = movePlayerInList(players, 'dani', -1, NOW);
    expect(ids(up)).toEqual(['ana', 'bea', 'dani', 'cris']);
  });

  it('en los extremos, o con un id desconocido, devuelve la misma lista', () => {
    const players = squad('ana', 'bea', 'cris');
    expect(movePlayerInList(players, 'ana', -1, NOW)).toEqual(players);
    expect(movePlayerInList(players, 'cris', 1, NOW)).toEqual(players);
    expect(movePlayerInList(players, 'zoe', 1, NOW)).toEqual(players);
    expect(movePlayerInList([], 'ana', 1, NOW)).toEqual([]);
  });
});

describe('reorderByIds', () => {
  it('pone primero los ids dados y después los que faltan en su orden; ignora desconocidos y repetidos', () => {
    const players = squad('ana', 'bea', 'cris', 'dani', 'eva');
    const result = reorderByIds(players, ['dani', 'zoe', 'bea', 'dani'], NOW);
    expect(ids(result)).toEqual(['dani', 'bea', 'ana', 'cris', 'eva']);
    expect(orders(result)).toEqual([0, 1, 2, 3, 4]);
    expect(result[4]).toBe(players[4]); // eva sigue la quinta: mismo objeto
  });

  it('con una lista vacía o solo ids desconocidos no cambia nada', () => {
    const players = squad('ana', 'bea');
    expect(reorderByIds(players, [], NOW)).toEqual(players);
    expect(reorderByIds(players, ['zoe'], NOW)).toEqual(players);
  });
});

describe('anonymizePlayer / toPlayerInfo', () => {
  it('anonymizePlayer borra datos personales, desactiva y marca eliminado conservando el id', () => {
    const p = mkPlayer('ana', { lastName: 'García', shirtNumber: 7, photoUri: 'file:///a.jpg', photoConsent: true, isGoalkeeper: true });
    expect(anonymizePlayer(p, NOW)).toEqual({
      ...p,
      firstName: 'Jugador eliminado',
      lastName: null,
      shirtNumber: null,
      photoUri: null,
      photoConsent: false,
      isActive: false,
      updatedAt: NOW,
      deletedAt: NOW,
    });
  });

  it('toPlayerInfo resuelve el nombre, pone dorsal 0 si falta y solo añade las marcas presentes', () => {
    const plain = mkPlayer('ana', { lastName: 'García' });
    expect(toPlayerInfo(plain, 'first_initial')).toStrictEqual({ id: 'ana', name: 'Ana G.', number: 0 });
    const keeper = mkPlayer('bea', { shirtNumber: 1, isGoalkeeper: true, photoUri: 'data:image/jpeg;base64,AAAA', photoConsent: true });
    expect(toPlayerInfo(keeper, 'full')).toStrictEqual({
      id: 'bea',
      name: 'Bea',
      number: 1,
      isGoalkeeper: true,
      photoUri: 'data:image/jpeg;base64,AAAA',
    });
  });
});

describe('defaultFormationFor / teamMatchConfig', () => {
  it('devuelve el dibujo de referencia de cada formato y 4-4-2 para valores sin presets', () => {
    expect(defaultFormationFor(7)).toBe('2-3-1');
    expect(defaultFormationFor(8)).toBe('3-3-1');
    expect(defaultFormationFor(11)).toBe('4-4-2');
    expect(defaultFormationFor(9)).toBe('4-4-2');
    expect(defaultFormationFor(5)).toBe('4-4-2');
  });

  it('teamMatchConfig saca los jugadores en campo del formato y copia partes y duración', () => {
    expect(teamMatchConfig({ defaultFormat: 'F7', periodsCount: 2, periodDurationMs: 1_500_000 })).toEqual({
      playersOnField: 7,
      periodsCount: 2,
      periodDurationMs: 1_500_000,
    });
    expect(teamMatchConfig({ defaultFormat: 'F11', periodsCount: 4, periodDurationMs: 600_000 }).playersOnField).toBe(11);
  });
});

describe('buildDefaultLineup', () => {
  const team = { defaultFormation: null };
  const NAMES = ['ana', 'bea', 'cris', 'dani', 'eva', 'fani', 'gala', 'hilda', 'ines'];

  it('titulares = primeros N activos en 2-3-1 con el portero en su área; banquillo = el resto en orden', () => {
    const players = squad(...NAMES).map((p) => (p.id === 'ana' ? { ...p, isGoalkeeper: true } : p));
    const { lineup, bench } = buildDefaultLineup(team, players, 7);
    expect(lineup[0]).toEqual({ playerId: 'ana', position: GOALKEEPER_SLOT, goalkeeper: true });
    expect(lineup.slice(1).map((e) => e.playerId)).toEqual(['bea', 'cris', 'dani', 'eva', 'fani', 'gala']);
    expect(lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    expect(bench).toEqual(['hilda', 'ines']);
  });

  it('un portero más abajo que N sustituye al N-ésimo titular', () => {
    const players = squad(...NAMES).map((p) => (p.id === 'hilda' ? { ...p, isGoalkeeper: true } : p));
    const { lineup, bench } = buildDefaultLineup(team, players, 7);
    expect(lineup[0]).toEqual({ playerId: 'hilda', position: GOALKEEPER_SLOT, goalkeeper: true });
    expect(lineup.slice(1).map((e) => e.playerId)).toEqual(['ana', 'bea', 'cris', 'dani', 'eva', 'fani']);
    expect(bench).toEqual(['gala', 'ines']);
  });

  it('con un portero entre los primeros N no se promociona a otro de más abajo; el segundo portero juega de campo', () => {
    const players = squad(...NAMES).map((p) => (p.id === 'cris' || p.id === 'ines' ? { ...p, isGoalkeeper: true } : p));
    const { lineup, bench } = buildDefaultLineup(team, players, 7);
    expect(lineup[0]).toEqual({ playerId: 'cris', position: GOALKEEPER_SLOT, goalkeeper: true });
    expect(bench).toEqual(['hilda', 'ines']);
    const two = squad('ana', 'bea').map((p) => ({ ...p, isGoalkeeper: true }));
    const small = buildDefaultLineup(team, two, 7);
    expect(small.lineup).toEqual([
      { playerId: 'ana', position: GOALKEEPER_SLOT, goalkeeper: true },
      { playerId: 'bea', position: formationSlots('2-3-1')[0] },
    ]);
  });

  it('sin ningún portero, el último titular ocupa la portería sin la marca', () => {
    const { lineup, bench } = buildDefaultLineup(team, squad(...NAMES), 7);
    expect(lineup).toHaveLength(7);
    expect(lineup.every((e) => !e.goalkeeper)).toBe(true);
    expect(lineup[6]).toEqual({ playerId: 'gala', position: GOALKEEPER_SLOT });
    expect(lineup.slice(0, 6).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    expect(bench).toEqual(['hilda', 'ines']);
  });

  it('con menos activos que N todos van al campo, hueco a hueco, y el banquillo queda vacío', () => {
    const players = squad('ana', 'bea', 'cris', 'dani').map((p) => (p.id === 'dani' ? { ...p, isGoalkeeper: true } : p));
    const { lineup, bench } = buildDefaultLineup(team, players, 7);
    expect(lineup).toEqual([
      { playerId: 'dani', position: GOALKEEPER_SLOT, goalkeeper: true },
      { playerId: 'ana', position: formationSlots('2-3-1')[0] },
      { playerId: 'bea', position: formationSlots('2-3-1')[1] },
      { playerId: 'cris', position: formationSlots('2-3-1')[2] },
    ]);
    expect(bench).toEqual([]);
    expect(buildDefaultLineup(team, [], 7)).toEqual({ lineup: [], bench: [] });
  });

  it('usa el dibujo del equipo si cuadra con el formato y el de referencia si no', () => {
    const players = squad(...NAMES).map((p) => (p.id === 'ana' ? { ...p, isGoalkeeper: true } : p));
    const own = buildDefaultLineup({ defaultFormation: '3-1-2' }, players, 7);
    expect(own.lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('3-1-2'));
    // '3-3-1' es de F8: con 7 en campo se ignora.
    const wrong = buildDefaultLineup({ defaultFormation: '3-3-1' }, players, 7);
    expect(wrong.lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('2-3-1'));
    const eight = buildDefaultLineup({ defaultFormation: '3-3-1' }, players, 8);
    expect(eight.lineup.slice(1).map((e) => e.position)).toEqual(formationSlots('3-3-1'));
    expect(eight.bench).toEqual(['ines']);
    expect(buildDefaultLineup({ defaultFormation: 'tres' }, players, 7).lineup.slice(1).map((e) => e.position)).toEqual(
      formationSlots('2-3-1'),
    );
  });

  it('inactivos y eliminados no entran ni en el campo ni en el banquillo', () => {
    const players = squad(...NAMES).map((p) => {
      if (p.id === 'bea') return { ...p, isActive: false };
      if (p.id === 'ines') return anonymizePlayer(p, NOW);
      return p;
    });
    const { lineup, bench } = buildDefaultLineup(team, players, 7);
    expect(lineup.map((e) => e.playerId)).toEqual(['ana', 'cris', 'dani', 'eva', 'fani', 'gala', 'hilda']);
    expect(bench).toEqual([]);
  });

  it('placeStarters coloca igual a partir de fichas (PlayerInfo) que de jugadores', () => {
    const entries = placeStarters([{ id: 'ana' }, { id: 'bea', isGoalkeeper: true }, { id: 'cris' }], '2-1');
    expect(entries).toEqual([
      { playerId: 'bea', position: GOALKEEPER_SLOT, goalkeeper: true },
      { playerId: 'ana', position: formationSlots('2-1')[0] },
      { playerId: 'cris', position: formationSlots('2-1')[1] },
    ]);
  });
});

describe('propiedades de la reordenación', () => {
  const squadArb = fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 20 })
    .chain((names) =>
      fc.record({
        players: fc
          .array(fc.integer({ min: -5, max: 40 }), { minLength: names.length, maxLength: names.length })
          .map((sortOrders) => names.map((id, i) => mkPlayer(id, { sortOrder: sortOrders[i] ?? i }))),
        index: fc.nat({ max: names.length - 1 }),
        direction: fc.constantFrom<-1 | 1>(-1, 1),
        ordered: fc.shuffledSubarray(names),
        unknown: fc.array(fc.string({ minLength: 7, maxLength: 9 }), { maxLength: 3 }),
      }),
    );

  const sameIds = (before: readonly Player[], after: readonly Player[]): boolean =>
    before.length === after.length && new Set(ids(after)).size === after.length && ids(before).every((id) => ids(after).includes(id));

  const numbered = (players: readonly Player[]): boolean => players.every((p, i) => p.sortOrder === i);

  it('withSortOrders, movePlayerInList y reorderByIds conservan el conjunto de ids y dejan sortOrder = 0..n-1', () => {
    fc.assert(
      fc.property(squadArb, ({ players, index, direction, ordered, unknown }) => {
        const renumbered = withSortOrders(players, NOW);
        expect(sameIds(players, renumbered)).toBe(true);
        expect(numbered(renumbered)).toBe(true);

        const moved = movePlayerInList(renumbered, renumbered[index]?.id ?? '', direction, NOW);
        expect(sameIds(players, moved)).toBe(true);
        expect(numbered(moved)).toBe(true);

        const reordered = reorderByIds(renumbered, [...unknown, ...ordered], NOW);
        expect(sameIds(players, reordered)).toBe(true);
        expect(numbered(reordered)).toBe(true);
        // Los ids pedidos van primero y en ese orden.
        expect(ids(reordered).slice(0, ordered.length)).toEqual(ordered);
      }),
      { numRuns: 300 },
    );
  });
});
