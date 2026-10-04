import { GOALKEEPER_SLOT, parseTeamPack, type TeamPack } from '../../core';
import { DELETED_PLAYER_NAME } from '../../core/squad';
import type { Player, PlayerDraft, Team, TeamDraft } from '../../core/team';
import { createInMemorySquadRepository, type SquadRepository } from '../../db';
import { SquadError, createSquadService, type SquadService } from '../squadService';

/**
 * Servicio de plantilla sobre el repositorio en memoria (sin storage) con
 * reloj e ids inyectados. Lo que se comprueba es el contrato de la fachada:
 * escribir antes de mostrar, cola serie, validación sin tocar el repositorio
 * y errores tipados. Nombres y dorsales inventados: el repositorio es público
 * y los datos reales son de menores.
 */

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

const TEAM_DRAFT: TeamDraft = {
  name: 'CD Prueba',
  category: 'Alevín',
  defaultFormat: 'F7',
  defaultFormation: null,
  periodsCount: 2,
  periodDurationMs: 25 * MINUTE,
  displayNameMode: 'full',
};

const draft = (firstName: string, overrides: Partial<PlayerDraft> = {}): PlayerDraft => ({
  firstName,
  lastName: null,
  shirtNumber: null,
  isGoalkeeper: false,
  isActive: true,
  photoUri: null,
  photoConsent: false,
  ...overrides,
});

function setup(repo: SquadRepository = createInMemorySquadRepository()) {
  let t = T0;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  let n = 0;
  const newId = () => `id-${String(++n).padStart(3, '0')}`;
  const service = createSquadService({ repo, now: clock.now, newId });
  return { service, repo, clock };
}

/** Servicio cargado con equipo y una plantilla con dorsales 1..n; portero: el indicado (por defecto el primero). */
async function withSquad(names = ['Ana', 'Bea', 'Cris'], goalkeeper = names[0]) {
  const ctx = setup();
  await ctx.service.load();
  await ctx.service.createTeam(TEAM_DRAFT);
  const players: Player[] = [];
  for (const [i, name] of names.entries()) {
    players.push(await ctx.service.addPlayer(draft(name, { shirtNumber: i + 1, isGoalkeeper: name === goalkeeper })));
  }
  const idOf = (name: string): string => {
    const found = players.find((p) => p.firstName === name);
    if (!found) throw new Error(`no existe ${name} en la plantilla de prueba`);
    return found.id;
  };
  return { ...ctx, players, idOf };
}

async function failure(promise: Promise<unknown>): Promise<SquadError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SquadError);
  return error as SquadError;
}

function failureSync(fn: () => unknown): SquadError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SquadError);
    return error as SquadError;
  }
  throw new Error('se esperaba un SquadError');
}

const names = (service: SquadService): string[] => service.getState().players.map((p) => p.firstName);
const orders = (service: SquadService): number[] => service.getState().players.map((p) => p.sortOrder);

/** Repositorio que falla en las operaciones indicadas (el resto delega en memoria). */
function failingRepo(failures: Partial<Record<keyof SquadRepository, boolean>>, message = 'disco lleno'): SquadRepository {
  const base = createInMemorySquadRepository();
  const wrap = <K extends keyof SquadRepository>(key: K): SquadRepository[K] =>
    ((...args: unknown[]) =>
      failures[key]
        ? Promise.reject(new Error(message))
        : (base[key] as (...a: unknown[]) => Promise<unknown>)(...args)) as SquadRepository[K];
  return {
    getTeam: wrap('getTeam'),
    saveTeam: wrap('saveTeam'),
    listPlayers: wrap('listPlayers'),
    getPlayer: wrap('getPlayer'),
    savePlayer: wrap('savePlayer'),
    savePlayers: wrap('savePlayers'),
  };
}

const PACK_SOURCE = {
  teamName: 'CD Paquete',
  formation: '3-1-2',
  starters: ['p4', 'p1'],
  players: [
    { id: 'p1', name: 'Ana', number: 1, isGoalkeeper: true },
    { id: 'p2', name: 'Bea', number: 0 },
    { id: 'p3', name: 'Cris', number: 3, photoUri: 'data:image/jpeg;base64,QUJDRA==' },
    { id: 'p4', name: 'Dani', number: 4 },
  ],
};

function pack(): TeamPack {
  const parsed = parseTeamPack(PACK_SOURCE);
  if (!parsed) throw new Error('el paquete de prueba no es válido');
  return parsed;
}

describe('createSquadService', () => {
  describe('carga', () => {
    it('arranca en loading y load() con el repositorio vacío deja ready sin equipo', async () => {
      const { service } = setup();
      expect(service.getState()).toEqual({ status: 'loading', error: null, team: null, players: [] });
      const state = await service.load();
      expect(state).toEqual({ status: 'ready', error: null, team: null, players: [] });
      expect(service.getState()).toBe(state);
    });

    it('devuelve el equipo y los jugadores ordenados por sortOrder aunque el repositorio los tenga en otro orden', async () => {
      const repo = createInMemorySquadRepository();
      const team: Team = { ...TEAM_DRAFT, id: 't1', createdAt: T0, updatedAt: T0 };
      const row = (id: string, firstName: string, sortOrder: number): Player => ({
        id,
        teamId: 't1',
        ...draft(firstName),
        sortOrder,
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
      });
      await repo.saveTeam(team);
      await repo.savePlayers([row('b', 'Bea', 1), row('a', 'Ana', 0)]);
      const { service } = setup(repo);
      const state = await service.load();
      expect(state.team).toEqual(team);
      expect(names(service)).toEqual(['Ana', 'Bea']);
    });

    it('dos load() simultáneos comparten la lectura y las siguientes no tocan el repositorio', async () => {
      const { service, repo } = setup();
      const getTeam = jest.spyOn(repo, 'getTeam');
      const [a, b] = await Promise.all([service.load(), service.load()]);
      expect(a).toBe(b);
      expect(getTeam).toHaveBeenCalledTimes(1);
      await service.load();
      expect(getTeam).toHaveBeenCalledTimes(1);
    });

    it('si el repositorio falla queda en error con mensaje en español, rechaza con STORAGE y se puede reintentar', async () => {
      const failures = { getTeam: true };
      const { service } = setup(failingRepo(failures));
      const error = await failure(service.load());
      expect(error.code).toBe('STORAGE');
      expect(error.message).toMatch(/No se pudo cargar/);
      expect((error.cause as Error).message).toBe('disco lleno');
      expect(service.getState()).toMatchObject({ status: 'error', error: 'No se pudo cargar el equipo y la plantilla' });

      failures.getTeam = false;
      await expect(service.load()).resolves.toMatchObject({ status: 'ready', error: null });
    });
  });

  describe('equipo', () => {
    it('createTeam asigna id y fechas, persiste antes de notificar y deja el estado listo', async () => {
      const { service, repo } = setup();
      await service.load();
      const seen: string[] = [];
      service.subscribe(() => {
        seen.push(service.getState().team?.name ?? '-');
      });
      const team = await service.createTeam({ ...TEAM_DRAFT, name: '  CD Prueba ', category: '  ' });
      expect(team).toEqual({ ...TEAM_DRAFT, id: 'id-001', name: 'CD Prueba', category: null, createdAt: T0, updatedAt: T0 });
      expect(service.getState()).toMatchObject({ status: 'ready', team });
      expect(seen).toEqual(['CD Prueba']);
      await expect(repo.getTeam()).resolves.toEqual(team);
    });

    it('createTeam con equipo existente lo sustituye manteniendo id y createdAt', async () => {
      const { service, repo, clock } = setup();
      await service.load();
      const first = await service.createTeam(TEAM_DRAFT);
      clock.advance(MINUTE);
      const second = await service.createTeam({ ...TEAM_DRAFT, name: 'CD Nuevo', displayNameMode: 'first' });
      expect(second).toMatchObject({ id: first.id, createdAt: T0, updatedAt: T0 + MINUTE, name: 'CD Nuevo', displayNameMode: 'first' });
      await expect(repo.getTeam()).resolves.toEqual(second);
    });

    it('un nombre en blanco rechaza VALIDATION sin tocar el repositorio', async () => {
      const { service, repo } = setup();
      await service.load();
      const error = await failure(service.createTeam({ ...TEAM_DRAFT, name: '   ' }));
      expect(error.code).toBe('VALIDATION');
      await expect(repo.getTeam()).resolves.toBeNull();
    });

    it('updateTeam rechaza NO_TEAM sin equipo y, con él, aplica solo las claves definidas del parche', async () => {
      const { service, clock } = setup();
      await service.load();
      expect((await failure(service.updateTeam({ name: 'x' }))).code).toBe('NO_TEAM');

      const created = await service.createTeam(TEAM_DRAFT);
      clock.advance(MINUTE);
      const updated = await service.updateTeam({ displayNameMode: 'first_initial', category: undefined, defaultFormation: '3-1-2' });
      expect(updated).toEqual({ ...created, displayNameMode: 'first_initial', defaultFormation: '3-1-2', updatedAt: T0 + MINUTE });
      expect(updated.category).toBe('Alevín');
      expect(service.getState().team).toBe(updated);
    });
  });

  describe('jugadores', () => {
    it('addPlayer sin equipo rechaza NO_TEAM', async () => {
      const { service } = setup();
      await service.load();
      expect((await failure(service.addPlayer(draft('Ana')))).code).toBe('NO_TEAM');
    });

    it('addPlayer normaliza la ficha, asigna teamId y sortOrder correlativo y la persiste', async () => {
      const { service, repo } = setup();
      await service.load();
      const team = await service.createTeam(TEAM_DRAFT);
      const ana = await service.addPlayer(draft('  Ana ', { lastName: '  ', shirtNumber: Number.NaN }));
      const bea = await service.addPlayer(draft('Bea', { shirtNumber: 9, isGoalkeeper: true }));
      expect(ana).toEqual({
        ...draft('Ana'),
        id: 'id-002',
        teamId: team.id,
        sortOrder: 0,
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
      });
      expect(bea).toMatchObject({ id: 'id-003', sortOrder: 1, shirtNumber: 9, isGoalkeeper: true });
      expect(service.getState().players).toEqual([ana, bea]);
      await expect(repo.listPlayers(team.id)).resolves.toEqual([ana, bea]);
    });

    it('una ficha con errores rechaza VALIDATION con issues y no toca el repositorio', async () => {
      const { service, repo } = await withSquad(['Ana']);
      const savePlayer = jest.spyOn(repo, 'savePlayer');
      const before = service.getState();
      const error = await failure(service.addPlayer(draft('', { photoUri: 'data:image/jpeg;base64,QUJD', photoConsent: false })));
      expect(error.code).toBe('VALIDATION');
      expect(error.issues.map((i) => i.code)).toEqual(['REQUIRED', 'PHOTO_WITHOUT_CONSENT']);
      expect(error.message).toContain('El nombre es obligatorio');
      expect(savePlayer).not.toHaveBeenCalled();
      expect(service.getState()).toBe(before);
    });

    it('un dorsal repetido es solo un aviso: se guarda', async () => {
      const { service } = await withSquad(['Ana']);
      const bea = await service.addPlayer(draft('Bea', { shirtNumber: 1 }));
      expect(bea.shirtNumber).toBe(1);
      expect(names(service)).toEqual(['Ana', 'Bea']);
    });

    it('updatePlayer valida el borrador fusionado con selfId, respeta los undefined del parche y rechaza NOT_FOUND', async () => {
      const { service, repo, clock, idOf } = await withSquad(['Ana', 'Bea']);
      clock.advance(MINUTE);
      // Su propio dorsal no cuenta como repetido; las claves undefined no pisan nada.
      const ana = await service.updatePlayer(idOf('Ana'), { lastName: ' Pérez ', shirtNumber: undefined });
      expect(ana).toMatchObject({ firstName: 'Ana', lastName: 'Pérez', shirtNumber: 1, isGoalkeeper: true, updatedAt: T0 + MINUTE });
      expect(service.getState().players[0]).toBe(ana);
      await expect(repo.getPlayer(ana.id)).resolves.toEqual(ana);

      const invalid = await failure(service.updatePlayer(idOf('Bea'), { firstName: ' ' }));
      expect(invalid.code).toBe('VALIDATION');
      expect(invalid.issues.map((i) => i.code)).toEqual(['REQUIRED']);

      expect((await failure(service.updatePlayer('nadie', { firstName: 'X' }))).code).toBe('NOT_FOUND');
    });

    it('si el repositorio falla al guardar, el estado no cambia, nadie es notificado y rechaza con STORAGE', async () => {
      const { service } = setup(failingRepo({ savePlayer: true }, 'sin espacio'));
      await service.load();
      await service.createTeam(TEAM_DRAFT);
      const before = service.getState();
      const listener = jest.fn();
      service.subscribe(listener);

      const error = await failure(service.addPlayer(draft('Ana')));
      expect(error.code).toBe('STORAGE');
      expect(error.message).toMatch(/No se pudo guardar/);
      expect((error.cause as Error).message).toBe('sin espacio');
      expect(service.getState()).toBe(before);
      expect(listener).not.toHaveBeenCalled();

      // La cola sigue viva: la siguiente escritura (que no falla) entra.
      await expect(service.updateTeam({ name: 'CD Sigue' })).resolves.toMatchObject({ name: 'CD Sigue' });
    });
  });

  describe('baja', () => {
    it('removePlayer anonimiza, renumera al resto y lo deja persistido en una sola llamada', async () => {
      const { service, repo, clock, idOf } = await withSquad(['Ana', 'Bea', 'Cris']);
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      clock.advance(MINUTE);
      await service.removePlayer(idOf('Bea'));

      expect(names(service)).toEqual(['Ana', 'Cris']);
      expect(orders(service)).toEqual([0, 1]);
      expect(savePlayers).toHaveBeenCalledTimes(1);
      await expect(repo.getPlayer(idOf('Bea'))).resolves.toMatchObject({
        firstName: DELETED_PLAYER_NAME,
        lastName: null,
        shirtNumber: null,
        photoUri: null,
        photoConsent: false,
        isActive: false,
        deletedAt: T0 + MINUTE,
        updatedAt: T0 + MINUTE,
      });

      const again = setup(repo).service;
      const reloaded = await again.load();
      expect(reloaded.players.map((p) => [p.firstName, p.sortOrder])).toEqual([
        ['Ana', 0],
        ['Cris', 1],
      ]);
    });

    it('removePlayer de un id desconocido rechaza NOT_FOUND', async () => {
      const { service } = await withSquad(['Ana']);
      expect((await failure(service.removePlayer('nadie'))).code).toBe('NOT_FOUND');
    });
  });

  describe('orden', () => {
    it('movePlayer intercambia con el vecino y persiste solo las filas que cambian', async () => {
      const { service, repo, idOf } = await withSquad(['Ana', 'Bea', 'Cris']);
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      await service.movePlayer(idOf('Cris'), -1);
      expect(names(service)).toEqual(['Ana', 'Cris', 'Bea']);
      expect(orders(service)).toEqual([0, 1, 2]);
      expect(savePlayers).toHaveBeenCalledTimes(1);
      expect(savePlayers.mock.calls[0]?.[0].map((p) => p.firstName).sort()).toEqual(['Bea', 'Cris']);
    });

    it('en los extremos (o con un id desconocido) no hace nada ni toca el repositorio', async () => {
      const { service, repo, idOf } = await withSquad(['Ana', 'Bea']);
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      const before = service.getState();
      await service.movePlayer(idOf('Ana'), -1);
      await service.movePlayer(idOf('Bea'), 1);
      await service.movePlayer('nadie', 1);
      expect(service.getState()).toBe(before);
      expect(savePlayers).not.toHaveBeenCalled();
    });

    it('dos movePlayer seguidos sin await se aplican en orden (cola serie) y quedan persistidos', async () => {
      const { service, repo, idOf } = await withSquad(['Ana', 'Bea', 'Cris']);
      const first = service.movePlayer(idOf('Cris'), -1);
      const second = service.movePlayer(idOf('Cris'), -1);
      await Promise.all([first, second]);
      expect(names(service)).toEqual(['Cris', 'Ana', 'Bea']);
      expect(orders(service)).toEqual([0, 1, 2]);
      const again = setup(repo).service;
      await again.load();
      expect(names(again)).toEqual(['Cris', 'Ana', 'Bea']);
    });

    it('reorder aplica el orden completo, deja al final los que faltan y persiste solo los que cambian', async () => {
      const { service, repo, idOf } = await withSquad(['Ana', 'Bea', 'Cris']);
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      await service.reorder([idOf('Bea'), 'desconocido', idOf('Ana'), idOf('Bea')]);
      expect(names(service)).toEqual(['Bea', 'Ana', 'Cris']);
      expect(orders(service)).toEqual([0, 1, 2]);
      expect(savePlayers.mock.calls[0]?.[0].map((p) => p.firstName).sort()).toEqual(['Ana', 'Bea']);
    });
  });

  describe('importTeamPack', () => {
    it('crea el equipo (F7, nombre del paquete, dibujo) y los jugadores con titulares primero, portero y foto con consentimiento', async () => {
      const { service, repo } = setup();
      await service.load();
      await service.importTeamPack(pack());

      const { team, players } = service.getState();
      expect(team).toEqual({
        id: 'id-001',
        name: 'CD Paquete',
        category: null,
        defaultFormat: 'F7',
        defaultFormation: '3-1-2',
        periodsCount: 2,
        periodDurationMs: 25 * MINUTE,
        displayNameMode: 'first',
        createdAt: T0,
        updatedAt: T0,
      });
      expect(players.map((p) => [p.firstName, p.sortOrder, p.shirtNumber, p.isGoalkeeper])).toEqual([
        ['Dani', 0, 4, false],
        ['Ana', 1, 1, true],
        ['Bea', 2, null, false],
        ['Cris', 3, 3, false],
      ]);
      expect(players.every((p) => p.teamId === 'id-001' && p.isActive && p.deletedAt === null && p.lastName === null)).toBe(true);
      expect(players.map((p) => p.id)).toEqual(['id-002', 'id-003', 'id-004', 'id-005']);
      const cris = players[3];
      expect(cris).toMatchObject({ photoUri: 'data:image/jpeg;base64,QUJDRA==', photoConsent: true });
      expect(players.filter((p) => p !== cris).every((p) => p.photoUri === null && !p.photoConsent)).toBe(true);
      await expect(repo.listPlayers('id-001')).resolves.toEqual(players);
    });

    it('la segunda importación rechaza NOT_EMPTY sin tocar nada', async () => {
      const { service, repo } = setup();
      await service.load();
      await service.importTeamPack(pack());
      const before = service.getState();
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      expect((await failure(service.importTeamPack(pack()))).code).toBe('NOT_EMPTY');
      expect(service.getState()).toBe(before);
      expect(savePlayers).not.toHaveBeenCalled();
    });

    it('con un equipo ya creado sin dibujo conserva el equipo y toma el dibujo del paquete; guarda el equipo antes que los jugadores', async () => {
      const { service, repo } = setup();
      await service.load();
      const created = await service.createTeam(TEAM_DRAFT);
      const saveTeam = jest.spyOn(repo, 'saveTeam');
      const savePlayers = jest.spyOn(repo, 'savePlayers');
      await service.importTeamPack(pack());

      expect(service.getState().team).toEqual({ ...created, defaultFormation: '3-1-2' });
      expect(names(service)).toEqual(['Dani', 'Ana', 'Bea', 'Cris']);
      expect(saveTeam).toHaveBeenCalledTimes(1);
      expect(saveTeam.mock.invocationCallOrder[0]).toBeLessThan(savePlayers.mock.invocationCallOrder[0] ?? -1);
    });

    it('con un equipo que ya tiene dibujo no lo pisa', async () => {
      const { service, repo } = setup();
      await service.load();
      await service.createTeam({ ...TEAM_DRAFT, defaultFormation: '2-3-1' });
      const saveTeam = jest.spyOn(repo, 'saveTeam');
      await service.importTeamPack(pack());
      expect(service.getState().team?.defaultFormation).toBe('2-3-1');
      expect(saveTeam).not.toHaveBeenCalled();
    });
  });

  describe('matchSetup', () => {
    it('sin equipo lanza NO_TEAM', async () => {
      const { service } = setup();
      await service.load();
      expect(failureSync(() => service.matchSetup()).code).toBe('NO_TEAM');
    });

    it('promociona al portero por debajo del corte, convoca solo activos y copia la configuración del equipo', async () => {
      const roster = ['Ana', 'Bea', 'Cris', 'Dani', 'Eli', 'Fran', 'Gema', 'Hana', 'Iris'];
      const { service, idOf } = await withSquad(roster, 'Iris');
      await service.updatePlayer(idOf('Dani'), { isActive: false });
      await service.updatePlayer(idOf('Ana'), { lastName: 'Pérez' });
      await service.updateTeam({ displayNameMode: 'first_initial' });

      const setupResult = service.matchSetup();
      const active = ['Ana', 'Bea', 'Cris', 'Eli', 'Fran', 'Gema', 'Hana', 'Iris'].map(idOf);
      expect(setupResult.teamName).toBe('CD Prueba');
      expect(setupResult.squad).toEqual(active);
      expect(Object.keys(setupResult.players)).toEqual(active);
      expect(setupResult.players[idOf('Ana')]).toEqual({ id: idOf('Ana'), name: 'Ana P.', number: 1 });
      expect(setupResult.players[idOf('Iris')]).toEqual({ id: idOf('Iris'), name: 'Iris', number: 9, isGoalkeeper: true });
      expect(setupResult.lineup.map((e) => e.playerId)).toEqual(['Iris', 'Ana', 'Bea', 'Cris', 'Eli', 'Fran', 'Gema'].map(idOf));
      expect(setupResult.lineup[0]).toEqual({ playerId: idOf('Iris'), position: GOALKEEPER_SLOT, goalkeeper: true });
      expect(setupResult.bench).toEqual([idOf('Hana')]);
      expect(setupResult.config).toEqual({ playersOnField: 7, periodsCount: 2, periodDurationMs: 25 * MINUTE, squad: active });
    });
  });

  describe('suscripción', () => {
    it('subscribe devuelve la baja y un suscriptor roto no impide notificar al resto', async () => {
      const { service } = setup();
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const broken = jest.fn(() => {
        throw new Error('bum');
      });
      const fine = jest.fn();
      const unsubscribeBroken = service.subscribe(broken);
      service.subscribe(fine);
      await service.load();
      expect(broken).toHaveBeenCalledTimes(1);
      expect(fine).toHaveBeenCalledTimes(1);

      unsubscribeBroken();
      await service.createTeam(TEAM_DRAFT);
      expect(broken).toHaveBeenCalledTimes(1);
      expect(fine).toHaveBeenCalledTimes(2);
      errors.mockRestore();
    });
  });
});

describe('createSquadService — fotos (regresiones de la revisión)', () => {
  const PHOTO = 'data:image/jpeg;base64,QUJD';
  async function withPhoto() {
    const ctx = setup();
    await ctx.service.load();
    await ctx.service.createTeam(TEAM_DRAFT);
    const ana = await ctx.service.addPlayer(draft('Ana', { shirtNumber: 1, photoUri: PHOTO, photoConsent: true }));
    return { ...ctx, ana };
  }

  it('updatePlayer de solo el dorsal conserva la foto y el consentimiento (en memoria y en el repositorio)', async () => {
    const { service, repo, ana } = await withPhoto();
    const updated = await service.updatePlayer(ana.id, { shirtNumber: 9 });
    expect(updated).toMatchObject({ shirtNumber: 9, photoUri: PHOTO, photoConsent: true });
    expect(await repo.getPlayer(ana.id)).toMatchObject({ shirtNumber: 9, photoUri: PHOTO, photoConsent: true });
  });

  it('removePlayer borra también la foto en el repositorio', async () => {
    const { service, repo, ana } = await withPhoto();
    await service.removePlayer(ana.id);
    expect(await repo.getPlayer(ana.id)).toMatchObject({ firstName: DELETED_PLAYER_NAME, lastName: null, shirtNumber: null, photoUri: null, photoConsent: false });
  });

  it('matchSetup lleva la foto a la ficha del partido', async () => {
    const { service, ana } = await withPhoto();
    expect(service.matchSetup().players[ana.id]).toStrictEqual({ id: ana.id, name: 'Ana', number: 1, photoUri: PHOTO });
  });

  it('un nombre demasiado largo en el paquete se recorta a la regla de la ficha y después se puede editar', async () => {
    const { service } = setup();
    await service.load();
    const pack = parseTeamPack({ teamName: 'CD Paquete', players: [{ id: 'larga', name: 'A'.repeat(45), number: 1 }] });
    await service.importTeamPack(pack as TeamPack);
    const player = service.getState().players[0];
    expect(player?.firstName).toHaveLength(40);
    await expect(service.updatePlayer(player!.id, { shirtNumber: 2 })).resolves.toMatchObject({ shirtNumber: 2 });
  });
});
