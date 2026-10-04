import type { Player, Team } from '../../core/team';
import { SquadRepositoryError, type SquadRepository } from '../squadRepository';
import { T0 } from './fixtures';

/**
 * Batería del contrato `SquadRepository`. Toda implementación (memoria con y
 * sin storage, SQLite) la ejecuta entera: el servicio de plantilla se apoya en
 * estas garantías y no debe notar la diferencia entre una y otra.
 *
 * Nombres y dorsales inventados: el repositorio es público y los datos reales
 * son de menores.
 */

export const TEAM_ID = 'team-1';
export const OTHER_TEAM_ID = 'team-2';

const FIRST_NAMES = ['Ana', 'Bea', 'Cris', 'Dani', 'Eli', 'Fran', 'Gema', 'Hana', 'Inés', 'Jara'];

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    name: 'CD Prueba',
    category: 'Alevín',
    federationName: null,
    defaultFormat: 'F7',
    defaultFormation: null,
    periodsCount: 2,
    periodDurationMs: 25 * 60_000,
    displayNameMode: 'full',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makePlayer(n: number, overrides: Partial<Player> = {}): Player {
  return {
    id: `player-${n}`,
    teamId: TEAM_ID,
    firstName: FIRST_NAMES[(n - 1) % FIRST_NAMES.length] ?? `Jugadora ${n}`,
    lastName: null,
    shirtNumber: n,
    isGoalkeeper: n === 1,
    isActive: true,
    photoUri: null,
    photoConsent: false,
    sortOrder: n - 1,
    createdAt: T0 + n,
    updatedAt: T0 + n,
    deletedAt: null,
    ...overrides,
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Data URI pseudoaleatorio (determinista) del tamaño pedido: detecta truncados y corrupciones que una repetición no vería. */
export function fakePhotoDataUri(length = 50 * 1024, seed = 12_345): string {
  const chars: string[] = [];
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    chars.push(BASE64[state % 64] ?? 'A');
  }
  return `data:image/jpeg;base64,${chars.join('')}`;
}

export async function repositoryError(promise: Promise<unknown>): Promise<SquadRepositoryError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SquadRepositoryError);
  return error as SquadRepositoryError;
}

export function describeSquadRepositoryContract(
  name: string,
  factory: () => Promise<SquadRepository> | SquadRepository,
): void {
  describe(`${name}: contrato SquadRepository`, () => {
    let repo: SquadRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    describe('equipo', () => {
      it('al principio no hay equipo ni jugadores', async () => {
        expect(await repo.getTeam()).toBeNull();
        expect(await repo.listPlayers(TEAM_ID)).toEqual([]);
        expect(await repo.getPlayer('player-1')).toBeNull();
      });

      it('guarda y devuelve el equipo idéntico, con los opcionales a null o con valor', async () => {
        const minimal = makeTeam({ category: null, defaultFormation: null });
        await repo.saveTeam(minimal);
        expect(await repo.getTeam()).toEqual(minimal);

        const full = makeTeam({
          name: 'UD Niños ⚽',
          category: 'Benjamín A',
          federationName: 'C.D. EJEMPLO "A"',
          defaultFormat: 'F8',
          defaultFormation: '3-1-2',
          periodsCount: 4,
          periodDurationMs: 12.5 * 60_000,
          displayNameMode: 'first_initial',
          updatedAt: T0 + 1,
        });
        await repo.saveTeam(full);
        expect(await repo.getTeam()).toEqual(full);
      });

      it('sustituye por id: el segundo guardado con el mismo id reemplaza todas las columnas', async () => {
        await repo.saveTeam(makeTeam());
        const replaced = makeTeam({ name: 'CD Otro', category: null, displayNameMode: 'first', updatedAt: T0 + 60_000 });
        await repo.saveTeam(replaced);
        expect(await repo.getTeam()).toEqual(replaced);
      });

      it('con dos equipos devuelve el de createdAt menor, aunque se guardara después', async () => {
        const later = makeTeam({ id: OTHER_TEAM_ID, name: 'Segundo', createdAt: T0 + 10, updatedAt: T0 + 10 });
        const first = makeTeam({ createdAt: T0 });
        await repo.saveTeam(later);
        await repo.saveTeam(first);
        expect(await repo.getTeam()).toEqual(first);
      });

      it('no comparte referencias: mutar la entrada o la salida no cambia lo guardado', async () => {
        const team = makeTeam();
        await repo.saveTeam(team);
        team.name = 'mutado';
        const read = await repo.getTeam();
        expect(read?.name).toBe('CD Prueba');
        read!.name = 'mutado otra vez';
        expect((await repo.getTeam())?.name).toBe('CD Prueba');
      });
    });

    describe('jugadores', () => {
      beforeEach(async () => {
        await repo.saveTeam(makeTeam());
      });

      it('guarda y devuelve un jugador con todos los campos (nulos, booleanos, acentos y emojis)', async () => {
        const bare = makePlayer(1, { lastName: null, shirtNumber: null, photoUri: null });
        const full = makePlayer(2, {
          firstName: 'Iñaki ⚽',
          lastName: 'Muñoz "el niño" \\',
          shirtNumber: 99,
          isGoalkeeper: true,
          isActive: false,
          photoUri: 'file:///fotos/2.jpg',
          photoConsent: true,
          sortOrder: 7,
        });
        await repo.savePlayer(bare);
        await repo.savePlayer(full);
        expect(await repo.getPlayer(bare.id)).toEqual(bare);
        expect(await repo.getPlayer(full.id)).toEqual(full);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([bare, full]);
      });

      it('listPlayers ordena por sortOrder, después createdAt y después id', async () => {
        const a = makePlayer(1, { id: 'player-a', sortOrder: 0, createdAt: T0 + 9 });
        const d = makePlayer(2, { id: 'player-d', sortOrder: 1, createdAt: T0 + 1 });
        const b = makePlayer(3, { id: 'player-b', sortOrder: 1, createdAt: T0 + 5 });
        const c = makePlayer(4, { id: 'player-c', sortOrder: 1, createdAt: T0 + 5 });
        await repo.savePlayer(c);
        await repo.savePlayer(a);
        await repo.savePlayer(b);
        await repo.savePlayer(d);
        expect((await repo.listPlayers(TEAM_ID)).map((p) => p.id)).toEqual(['player-a', 'player-d', 'player-b', 'player-c']);
      });

      it('listPlayers incluye inactivos, excluye eliminados y solo devuelve los del equipo pedido', async () => {
        await repo.saveTeam(makeTeam({ id: OTHER_TEAM_ID, name: 'Otro', createdAt: T0 + 1 }));
        const active = makePlayer(1);
        const inactive = makePlayer(2, { isActive: false });
        const deleted = makePlayer(3, { firstName: 'Jugador #3', lastName: null, photoUri: null, deletedAt: T0 + 500 });
        const other = makePlayer(4, { teamId: OTHER_TEAM_ID });
        await repo.savePlayers([active, inactive, deleted]);
        await repo.savePlayer(other);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([active, inactive]);
        expect(await repo.listPlayers(OTHER_TEAM_ID)).toEqual([other]);
        expect(await repo.listPlayers('equipo-inexistente')).toEqual([]);
      });

      it('getPlayer devuelve también un eliminado, con su deletedAt', async () => {
        const deleted = makePlayer(3, { firstName: 'Jugador #3', deletedAt: T0 + 500 });
        await repo.savePlayer(deleted);
        expect(await repo.getPlayer(deleted.id)).toEqual(deleted);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([]);
      });

      it('savePlayer por id conserva una sola fila con los valores nuevos', async () => {
        const original = makePlayer(1);
        await repo.savePlayer(original);
        const updated = { ...original, firstName: 'Ana María', shirtNumber: 10, isGoalkeeper: false, updatedAt: T0 + 99 };
        await repo.savePlayer(updated);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([updated]);
        expect(await repo.getPlayer(original.id)).toEqual(updated);
      });

      it('savePlayers: el lote vacío no hace nada y un lote mezcla altas y actualizaciones', async () => {
        await repo.savePlayers([]);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([]);

        const p1 = makePlayer(1);
        await repo.savePlayer(p1);
        const p1Moved = { ...p1, sortOrder: 2 };
        const p2 = makePlayer(2, { sortOrder: 0 });
        const p3 = makePlayer(3, { sortOrder: 1 });
        await repo.savePlayers([p1Moved, p2, p3]);
        expect(await repo.listPlayers(TEAM_ID)).toEqual([p2, p3, p1Moved]);
      });

      it('savePlayers es atómico: una fila inválida (equipo inexistente) deshace el lote entero', async () => {
        const p1 = makePlayer(1);
        await repo.savePlayer(p1);
        const p2 = makePlayer(2);
        const alien = makePlayer(3, { teamId: 'equipo-inexistente' });

        const error = await repositoryError(repo.savePlayers([{ ...p1, firstName: 'Cambiada' }, p2, alien]));
        expect(error.code).toBe('STORAGE');

        expect(await repo.getPlayer(p1.id)).toEqual(p1);
        expect(await repo.getPlayer(p2.id)).toBeNull();
        expect(await repo.getPlayer(alien.id)).toBeNull();
        expect(await repo.listPlayers(TEAM_ID)).toEqual([p1]);
      });

      it('una foto como data URI de 50 KB va y vuelve intacta, suelta y en lote', async () => {
        const photo = fakePhotoDataUri(50 * 1024);
        expect(photo.length).toBeGreaterThan(50 * 1024);
        const single = makePlayer(1, { photoUri: photo, photoConsent: true });
        await repo.savePlayer(single);
        expect((await repo.getPlayer(single.id))?.photoUri).toBe(photo);

        const batch = [2, 3, 4].map((n) => makePlayer(n, { photoUri: fakePhotoDataUri(50 * 1024, n), photoConsent: true }));
        await repo.savePlayers(batch);
        const listed = await repo.listPlayers(TEAM_ID);
        expect(listed).toEqual([single, ...batch]);
      });

      it('no comparte referencias con el llamador ni entre lecturas', async () => {
        const player = makePlayer(1);
        await repo.savePlayer(player);
        player.firstName = 'mutada';
        const [read] = await repo.listPlayers(TEAM_ID);
        expect(read?.firstName).toBe('Ana');
        read!.firstName = 'mutada otra vez';
        read!.deletedAt = T0;
        expect((await repo.getPlayer(player.id))?.firstName).toBe('Ana');
        expect(await repo.listPlayers(TEAM_ID)).toHaveLength(1);
      });
    });
  });
}
