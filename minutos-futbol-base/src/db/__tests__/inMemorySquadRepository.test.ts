import { DEFAULT_SQUAD_STORAGE_KEY, createInMemorySquadRepository } from '../inMemorySquadRepository';
import { createFakeStorage } from './fakeStorage';
import { T0 } from './fixtures';
import { TEAM_ID, describeSquadRepositoryContract, fakePhotoDataUri, makePlayer, makeTeam, repositoryError } from './squadRepositoryContract';

describeSquadRepositoryContract('InMemorySquadRepository (sin storage)', () => createInMemorySquadRepository());

describeSquadRepositoryContract('InMemorySquadRepository (con storage falso)', () =>
  createInMemorySquadRepository({ storage: createFakeStorage() }),
);

describe('InMemorySquadRepository: storage', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('persiste entre instancias con el mismo storage: equipo, jugadores, eliminados y fotos', async () => {
    const storage = createFakeStorage();
    const first = createInMemorySquadRepository({ storage });
    const team = makeTeam({ defaultFormation: '2-3-1' });
    const p1 = makePlayer(1, { photoUri: fakePhotoDataUri(50 * 1024), photoConsent: true });
    const p2 = makePlayer(2, { isActive: false, lastName: 'Pérez' });
    const gone = makePlayer(3, { firstName: 'Jugador #3', deletedAt: T0 + 9 });
    await first.saveTeam(team);
    await first.savePlayers([p1, p2, gone]);

    const second = createInMemorySquadRepository({ storage });
    expect(await second.getTeam()).toEqual(team);
    expect(await second.listPlayers(TEAM_ID)).toEqual([p1, p2]);
    expect(await second.getPlayer(gone.id)).toEqual(gone);
    expect(warn).not.toHaveBeenCalled();
  });

  it('serializa { version: 1, team, players } completo en la clave por defecto tras cada escritura', async () => {
    const storage = createFakeStorage();
    const repo = createInMemorySquadRepository({ storage });
    expect(storage.writes).toBe(0);

    const team = makeTeam();
    await repo.saveTeam(team);
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY) ?? '')).toEqual({ version: 1, team, players: [] });

    const p1 = makePlayer(1);
    const p2 = makePlayer(2);
    await repo.savePlayers([p1, p2]);
    await repo.savePlayer({ ...p1, firstName: 'Ana B.' });
    expect(storage.writes).toBe(3);
    expect(JSON.parse(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      team,
      players: [{ ...p1, firstName: 'Ana B.' }, p2],
    });
    expect(DEFAULT_SQUAD_STORAGE_KEY).toBe('minutos-futbol-base.squad.v1');
  });

  it('un JSON guardado antes de existir federationName se lee con federationName null', async () => {
    const { federationName: _omitted, ...legacy } = makeTeam();
    const storage = createFakeStorage({ [DEFAULT_SQUAD_STORAGE_KEY]: JSON.stringify({ version: 1, team: legacy, players: [] }) });
    const repo = createInMemorySquadRepository({ storage });
    expect(await repo.getTeam()).toEqual(makeTeam({ federationName: null }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('respeta storageKey', async () => {
    const storage = createFakeStorage();
    const repo = createInMemorySquadRepository({ storage, storageKey: 'pruebas.squad' });
    await repo.saveTeam(makeTeam());
    expect([...storage.data.keys()]).toEqual(['pruebas.squad']);
    expect(await createInMemorySquadRepository({ storage, storageKey: 'pruebas.squad' }).getTeam()).toEqual(makeTeam());
  });

  it('storage corrupto (JSON inválido): lo copia a <clave>.corrupt, no lo pisa y arranca vacío con aviso', async () => {
    const raw = '{"version":1,"team":{"id":"t"';
    const storage = createFakeStorage({ [DEFAULT_SQUAD_STORAGE_KEY]: raw });
    const repo = createInMemorySquadRepository({ storage });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY)).toBe(raw);
    expect(storage.data.get(`${DEFAULT_SQUAD_STORAGE_KEY}.corrupt`)).toBe(raw);
    expect(await repo.getTeam()).toBeNull();
    expect(await repo.listPlayers(TEAM_ID)).toEqual([]);

    // La primera escritura confirmada sí sobrescribe la clave; la copia se conserva.
    await repo.saveTeam(makeTeam());
    expect(JSON.parse(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY) ?? '')).toMatchObject({ version: 1, team: makeTeam() });
    expect(storage.data.get(`${DEFAULT_SQUAD_STORAGE_KEY}.corrupt`)).toBe(raw);
  });

  it.each([
    ['versión desconocida', JSON.stringify({ version: 2, team: null, players: [] })],
    ['players que no es una lista', JSON.stringify({ version: 1, team: null, players: {} })],
    ['jugador sin teamId', JSON.stringify({ version: 1, team: makeTeam(), players: [{ ...makePlayer(1), teamId: undefined }] })],
    ['equipo con formato desconocido', JSON.stringify({ version: 1, team: { ...makeTeam(), defaultFormat: 'F5' }, players: [] })],
    ['booleano que no es booleano', JSON.stringify({ version: 1, team: makeTeam(), players: [{ ...makePlayer(1), isActive: 'sí' }] })],
    ['un array en vez de un objeto', '[1,2,3]'],
  ])('JSON válido pero ininterpretable (%s): copia y arranque vacío', async (_label, raw) => {
    const storage = createFakeStorage({ [DEFAULT_SQUAD_STORAGE_KEY]: raw });
    const repo = createInMemorySquadRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.data.get(`${DEFAULT_SQUAD_STORAGE_KEY}.corrupt`)).toBe(raw);
    expect(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY)).toBe(raw);
    expect(await repo.getTeam()).toBeNull();
    expect(await repo.listPlayers(TEAM_ID)).toEqual([]);
  });

  it('si getItem lanza, arranca vacío con aviso y sigue funcionando', async () => {
    const storage = createFakeStorage();
    storage.getItem = () => {
      throw new Error('acceso denegado');
    };
    const repo = createInMemorySquadRepository({ storage });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await repo.getTeam()).toBeNull();
    await repo.saveTeam(makeTeam());
    expect(storage.data.has(DEFAULT_SQUAD_STORAGE_KEY)).toBe(true);
  });

  it('sin storage no escribe en ningún sitio (ni siquiera en un localStorage global)', async () => {
    const globalFake = createFakeStorage();
    const scope = globalThis as { localStorage?: unknown };
    const previous = scope.localStorage;
    scope.localStorage = globalFake;
    try {
      const repo = createInMemorySquadRepository();
      await repo.saveTeam(makeTeam());
      await repo.savePlayers([makePlayer(1), makePlayer(2)]);
      expect(await repo.listPlayers(TEAM_ID)).toHaveLength(2);
      expect(globalFake.writes).toBe(0);
      expect(globalFake.data.size).toBe(0);
    } finally {
      if (previous === undefined) delete scope.localStorage;
      else scope.localStorage = previous;
    }
  });

  it('si setItem falla (cuota), rechaza con STORAGE y la memoria no cambia', async () => {
    const storage = createFakeStorage();
    const repo = createInMemorySquadRepository({ storage });
    await repo.saveTeam(makeTeam());
    await repo.savePlayer(makePlayer(1));

    const quota = new Error('QuotaExceededError');
    storage.failNextWrite = quota;
    const error = await repositoryError(repo.savePlayers([{ ...makePlayer(1), firstName: 'Cambiada' }, makePlayer(2)]));
    expect(error.code).toBe('STORAGE');
    expect(error.cause).toBe(quota);
    expect(await repo.listPlayers(TEAM_ID)).toEqual([makePlayer(1)]);
    expect(JSON.parse(storage.data.get(DEFAULT_SQUAD_STORAGE_KEY) ?? '')).toMatchObject({ players: [makePlayer(1)] });

    // Recuperado el storage, la siguiente escritura entra.
    await repo.savePlayer(makePlayer(2));
    expect(await repo.listPlayers(TEAM_ID)).toHaveLength(2);
  });
});

describe('InMemorySquadRepository: lotes inválidos', () => {
  it.each([
    ['sin storage', () => createInMemorySquadRepository()],
    ['con storage', () => createInMemorySquadRepository({ storage: createFakeStorage() })],
  ])('%s: un objeto que no se puede serializar (BigInt) rechaza con STORAGE y no guarda nada', async (_label, create) => {
    const repo = create();
    await repo.saveTeam(makeTeam());
    const bad = makePlayer(2, { shirtNumber: 10n as unknown as number });
    const error = await repositoryError(repo.savePlayers([makePlayer(1), bad]));
    expect(error.code).toBe('STORAGE');
    expect(await repo.listPlayers(TEAM_ID)).toEqual([]);
    expect((await repositoryError(repo.savePlayer(bad))).code).toBe('STORAGE');
    expect(await repo.getPlayer(bad.id)).toBeNull();
  });

  it('un equipo con un campo imposible rechaza con STORAGE y getTeam sigue nulo', async () => {
    const repo = createInMemorySquadRepository();
    const bad = makeTeam({ periodsCount: Number.NaN });
    expect((await repositoryError(repo.saveTeam(bad))).code).toBe('STORAGE');
    expect(await repo.getTeam()).toBeNull();
  });

  it('savePlayers con jugadores de equipos distintos rechaza con STORAGE y no guarda ninguno', async () => {
    const repo = createInMemorySquadRepository();
    const error = await repositoryError(repo.savePlayers([makePlayer(1), makePlayer(2, { teamId: 'team-2' })]));
    expect(error.code).toBe('STORAGE');
    expect(error.message).toMatch(/mismo equipo/);
    expect(await repo.getPlayer('player-1')).toBeNull();
    expect(await repo.getPlayer('player-2')).toBeNull();
  });

  it('normaliza undefined a null en los opcionales al guardar', async () => {
    const repo = createInMemorySquadRepository();
    const loose = { ...makePlayer(1), lastName: undefined, photoUri: undefined } as unknown as Parameters<typeof repo.savePlayer>[0];
    await repo.savePlayer(loose);
    expect(await repo.getPlayer('player-1')).toEqual(makePlayer(1, { lastName: null, photoUri: null }));
  });
});
