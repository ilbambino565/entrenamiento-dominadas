import { defaultConvocation, keepConvocable, toggleConvocation, validateConvocation } from '../convocation';
import type { Player } from '../team';

const player = (n: number, overrides: Partial<Player> = {}): Player => ({
  id: `p${n}`,
  teamId: 't',
  firstName: `Jugador${n}`,
  lastName: null,
  shirtNumber: n,
  isGoalkeeper: false,
  isActive: true,
  photoUri: null,
  photoConsent: false,
  sortOrder: n,
  createdAt: n,
  updatedAt: n,
  deletedAt: null,
  ...overrides,
});

// Desordenada a propósito: p3 inactivo, p5 eliminado.
const squad = [player(4), player(1), player(3, { isActive: false }), player(2), player(5, { deletedAt: 9 })];

describe('convocation', () => {
  it('por defecto convoca a los activos no eliminados en orden de plantilla', () => {
    expect(defaultConvocation(squad)).toEqual(['p1', 'p2', 'p4']);
    expect(defaultConvocation([])).toEqual([]);
  });

  it('marcar y desmarcar devuelven la selección en orden de plantilla', () => {
    const all = defaultConvocation(squad);
    const without2 = toggleConvocation(squad, all, 'p2');
    expect(without2).toEqual(['p1', 'p4']);
    expect(toggleConvocation(squad, without2, 'p2')).toEqual(['p1', 'p2', 'p4']);
    expect(all).toEqual(['p1', 'p2', 'p4']);
  });

  it('no deja convocar a un inactivo, a un eliminado ni a un id desconocido', () => {
    expect(toggleConvocation(squad, ['p1'], 'p3')).toEqual(['p1']);
    expect(toggleConvocation(squad, ['p1'], 'p5')).toEqual(['p1']);
    expect(toggleConvocation(squad, ['p1'], 'nadie')).toEqual(['p1']);
    expect(keepConvocable(squad, ['p4', 'p3', 'zz', 'p1'])).toEqual(['p1', 'p4']);
  });

  it('valida: error sin convocados, aviso con menos que jugadores en campo, nada si hay de sobra', () => {
    expect(validateConvocation(0, 7)).toEqual({ level: 'error', message: 'Convoca al menos a un jugador' });
    expect(validateConvocation(5, 7)).toEqual({ level: 'warning', message: 'Con 5 jugadores faltan 2 para completar el campo de 7' });
    expect(validateConvocation(7, 7)).toBeNull();
    expect(validateConvocation(12, 7)).toBeNull();
  });
});
