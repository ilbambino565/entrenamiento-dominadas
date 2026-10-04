import { fireEvent, render, waitFor, within, type RenderResult } from '@testing-library/react-native';
import { createSquadService, type SquadService } from '../../../app-services/squadService';
import { DELETED_PLAYER_NAME } from '../../../core/squad';
import type { PlayerDraft, TeamDraft } from '../../../core/team';
import { createInMemorySquadRepository } from '../../../db/inMemorySquadRepository';
import type { KeyValueStorage, SquadRepository } from '../../../db/squadRepository';
import { PlayerFormScreen } from '../PlayerFormScreen';
import { SquadScreen } from '../SquadScreen';
import { TeamScreen } from '../TeamScreen';

/**
 * P2-P4 con el servicio REAL (`createSquadService`) sobre el repositorio en
 * memoria, con y sin almacén clave-valor: lo que la pantalla muestra es lo que
 * hay en el repositorio, y una "segunda sesión" (otro repositorio sobre el
 * mismo almacén, sin cargar) lee lo que la primera guardó, como una recarga en
 * web con localStorage. Complementa los tests con el doble
 * (`fakeSquadService`), que cubren los estados de pantalla con ids fijos.
 * Nombres inventados: el repositorio es público y los datos reales son de
 * menores. RNTL 14: `render` y `fireEvent` se esperan; lo que pasa por el
 * repositorio se espera con `findBy*`/`waitFor`.
 */
const T0 = 1_700_000_000_000;
type Instance = ReturnType<RenderResult['getByTestId']>;
const isSelected = (el: Instance) => (el.props as { accessibilityState?: { selected?: boolean } }).accessibilityState?.selected === true;
const isDisabled = (el: Instance) => (el.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled === true;

/** localStorage de juguete: síncrono y en memoria, como el de web. */
function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** Servicio real con reloj e ids deterministas. */
function makeService(repo: SquadRepository): SquadService {
  let ids = 0;
  let tick = 0;
  return createSquadService({ repo, now: () => T0 + ++tick * 1000, newId: () => `id-${String(++ids).padStart(3, '0')}` });
}

const TEAM: TeamDraft = {
  name: 'CD Prueba',
  category: 'Alevín',
  defaultFormat: 'F7',
  defaultFormation: null,
  periodsCount: 2,
  periodDurationMs: 25 * 60_000,
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

/** Equipo con tres jugadoras: Ana (portera, #1), Bea (#5, con apellido) y Cris (inactiva, sin dorsal). */
async function seed(repo: SquadRepository): Promise<SquadService> {
  const service = makeService(repo);
  await service.load();
  await service.createTeam(TEAM);
  await service.addPlayer(draft('Ana', { lastName: 'García', shirtNumber: 1, isGoalkeeper: true }));
  await service.addPlayer(draft('Bea', { lastName: 'Soler', shirtNumber: 5 }));
  await service.addPlayer(draft('Cris', { isActive: false }));
  return service;
}

function idOf(service: SquadService, firstName: string): string {
  const player = service.getState().players.find((p) => p.firstName === firstName);
  if (!player) throw new Error(`No hay jugador ${firstName}`);
  return player.id;
}

function teamIdOf(service: SquadService): string {
  const team = service.getState().team;
  if (!team) throw new Error('No hay equipo');
  return team.id;
}

const rowIds = (screen: RenderResult): string[] =>
  screen.getAllByTestId(/^player-row-/).map((row) => String(row.props.testID).replace('player-row-', ''));

/** Espera a que un control vuelva a estar habilitado (los chips y GUARDAR se deshabilitan mientras se escribe). */
const enabled = (screen: RenderResult, testID: string) => waitFor(() => expect(isDisabled(screen.getByTestId(testID))).toBe(false));

describe('SquadScreen (P2) con el servicio real', () => {
  it('carga la plantilla del repositorio al montar y el nuevo orden se persiste: lo lee otra sesión sobre el mismo almacén', async () => {
    const storage = memoryStorage();
    const seeded = await seed(createInMemorySquadRepository({ storage }));
    const [ana, bea, cris] = ['Ana', 'Bea', 'Cris'].map((n) => idOf(seeded, n)) as [string, string, string];

    // Segunda sesión: otro repositorio sobre el mismo almacén y un servicio sin cargar.
    const repo = createInMemorySquadRepository({ storage });
    const service = makeService(repo);
    expect(service.getState().status).toBe('loading');
    const onEditPlayer = jest.fn();
    const screen = await render(<SquadScreen service={service} onAddPlayer={jest.fn()} onEditPlayer={onEditPlayer} />);

    expect(await screen.findByTestId(`player-row-${ana}`)).toBeTruthy();
    expect(screen.getByTestId('squad-title')).toHaveTextContent('Plantilla (3)');
    expect(rowIds(screen)).toEqual([ana, bea, cris]);
    expect(within(screen.getByTestId(`player-row-${ana}`)).getByTestId(`player-number-${ana}`)).toHaveTextContent('#1');
    expect(screen.getByTestId(`player-gk-${ana}`)).toBeTruthy();
    expect(within(screen.getByTestId(`player-row-${bea}`)).getByTestId(`player-name-${bea}`)).toHaveTextContent('Bea Soler');
    expect(screen.getByTestId(`player-number-${cris}`)).toHaveTextContent('—');
    expect(screen.getByTestId(`player-inactive-${cris}`)).toHaveTextContent('inactivo');

    await fireEvent.press(screen.getByTestId(`player-row-${bea}`));
    expect(onEditPlayer).toHaveBeenCalledWith(bea);

    await fireEvent.press(screen.getByTestId('toggle-reorder'));
    await fireEvent.press(screen.getByTestId(`move-down-${ana}`));
    await waitFor(() => expect(rowIds(screen)).toEqual([bea, ana, cris]));

    // Persistido: el repositorio y una tercera sesión sobre el mismo almacén ven el nuevo orden.
    const rows = await repo.listPlayers(teamIdOf(service));
    expect(rows.map((p) => [p.id, p.sortOrder])).toEqual([
      [bea, 0],
      [ana, 1],
      [cris, 2],
    ]);
    const third = makeService(createInMemorySquadRepository({ storage }));
    expect((await third.load()).players.map((p) => p.firstName)).toEqual(['Bea', 'Ana', 'Cris']);
  });

  it('si el repositorio falla al cargar, la pantalla muestra el error del servicio', async () => {
    const broken: SquadRepository = { ...createInMemorySquadRepository(), getTeam: () => Promise.reject(new Error('disco')) };
    const screen = await render(<SquadScreen service={makeService(broken)} onAddPlayer={jest.fn()} onEditPlayer={jest.fn()} />);
    expect(await screen.findByTestId('squad-error')).toHaveTextContent('No se pudo cargar el equipo y la plantilla');
    expect(screen.queryByText('Aún no hay jugadores')).toBeNull();
  });
});

describe('PlayerFormScreen (P3) con el servicio real', () => {
  it('alta: GUARDAR escribe el jugador normalizado al final del orden y llama a onDone', async () => {
    const repo = createInMemorySquadRepository();
    const service = await seed(repo);
    const onDone = jest.fn();
    const screen = await render(<PlayerFormScreen service={service} playerId={null} onDone={onDone} />);

    await fireEvent.changeText(screen.getByTestId('first-name'), '  Dani ');
    await fireEvent.changeText(screen.getByTestId('last-name'), '   ');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '9');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const rows = await repo.listPlayers(teamIdOf(service));
    expect(rows.map((p) => p.firstName)).toEqual(['Ana', 'Bea', 'Cris', 'Dani']);
    expect(rows[3]).toMatchObject({
      firstName: 'Dani',
      lastName: null,
      shirtNumber: 9,
      isGoalkeeper: false,
      isActive: true,
      photoUri: null,
      photoConsent: false,
      sortOrder: 3,
      deletedAt: null,
    });
    expect(service.getState().players).toHaveLength(4);
  });

  it('edición: precarga desde el repositorio, persiste el dorsal nuevo y eliminar anonimiza la fila sin borrarla del almacén', async () => {
    const repo = createInMemorySquadRepository();
    const service = await seed(repo);
    const bea = idOf(service, 'Bea');
    const onDone = jest.fn();
    const screen = await render(<PlayerFormScreen service={service} playerId={bea} onDone={onDone} />);
    expect(screen.getByTestId('first-name').props.value).toBe('Bea');
    expect(screen.getByTestId('last-name').props.value).toBe('Soler');
    expect(screen.getByTestId('shirt-number').props.value).toBe('5');

    await fireEvent.changeText(screen.getByTestId('shirt-number'), '9');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(await repo.getPlayer(bea)).toMatchObject({ firstName: 'Bea', lastName: 'Soler', shirtNumber: 9, deletedAt: null });

    await enabled(screen, 'delete');
    await fireEvent.press(screen.getByTestId('delete'));
    await fireEvent.press(screen.getByTestId('confirm-delete'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));

    // Derecho de supresión: la fila sigue (sus minutos pasados cuadran) pero sin nombre, dorsal ni foto, y fuera de la lista.
    const stored = await repo.getPlayer(bea);
    expect(stored).toMatchObject({ firstName: DELETED_PLAYER_NAME, lastName: null, shirtNumber: null, photoUri: null, photoConsent: false, isActive: false });
    expect(stored?.deletedAt).not.toBeNull();
    const rows = await repo.listPlayers(teamIdOf(service));
    expect(rows.map((p) => [p.firstName, p.sortOrder])).toEqual([
      ['Ana', 0],
      ['Cris', 1],
    ]);
    expect(await screen.findByTestId('player-missing')).toHaveTextContent('Jugador no encontrado');
  });

  it('si el repositorio rechaza la escritura, el estado no cambia, se muestra el error y se puede reintentar', async () => {
    const inner = createInMemorySquadRepository();
    let failing = false;
    const repo: SquadRepository = {
      ...inner,
      savePlayer: (player) => (failing ? Promise.reject(new Error('disco lleno')) : inner.savePlayer(player)),
    };
    const service = await seed(repo);
    const onDone = jest.fn();
    const screen = await render(<PlayerFormScreen service={service} playerId={null} onDone={onDone} />);
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');

    failing = true;
    await fireEvent.press(screen.getByTestId('save'));
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('No se pudo guardar el jugador: disco lleno');
    expect(onDone).not.toHaveBeenCalled();
    expect(service.getState().players.map((p) => p.firstName)).toEqual(['Ana', 'Bea', 'Cris']);
    expect(await inner.listPlayers(teamIdOf(service))).toHaveLength(3);

    failing = false;
    await enabled(screen, 'save');
    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect((await inner.listPlayers(teamIdOf(service))).map((p) => p.firstName)).toEqual(['Ana', 'Bea', 'Cris', 'Eva']);
  });
});

describe('TeamScreen (P4) con el servicio real', () => {
  it('sin equipo en el repositorio muestra "Primero crea el equipo"', async () => {
    const screen = await render(<TeamScreen service={makeService(createInMemorySquadRepository())} />);
    expect(await screen.findByTestId('team-missing')).toHaveTextContent('Primero crea el equipo');
    expect(screen.queryByTestId('team-name')).toBeNull();
  });

  it('precarga el equipo guardado; chips y nombre se persisten y otra sesión sobre el mismo almacén los lee', async () => {
    const storage = memoryStorage();
    await seed(createInMemorySquadRepository({ storage }));
    const repo = createInMemorySquadRepository({ storage });
    const service = makeService(repo);
    const screen = await render(<TeamScreen service={service} />);

    const name = await screen.findByTestId('team-name');
    expect(name.props.value).toBe('CD Prueba');
    expect(screen.getByTestId('team-category').props.value).toBe('Alevín');
    expect(screen.getByTestId('period-minutes').props.value).toBe('25');
    expect(isSelected(screen.getByTestId('format-F7'))).toBe(true);
    expect(isSelected(screen.getByTestId('formation-auto'))).toBe(true);
    expect(isSelected(screen.getByTestId('names-full'))).toBe(true);

    await fireEvent.press(screen.getByTestId('format-F11'));
    await waitFor(() => expect(isSelected(screen.getByTestId('format-F11'))).toBe(true));
    expect(await repo.getTeam()).toMatchObject({ defaultFormat: 'F11', defaultFormation: null });

    await enabled(screen, 'formation-4-4-2');
    await fireEvent.press(screen.getByTestId('formation-4-4-2'));
    await waitFor(() => expect(isSelected(screen.getByTestId('formation-4-4-2'))).toBe(true));

    await fireEvent.changeText(screen.getByTestId('team-name'), ' Nuevo CF ');
    await fireEvent(screen.getByTestId('team-name'), 'blur');
    await waitFor(() => expect(service.getState().team?.name).toBe('Nuevo CF'));

    await enabled(screen, 'names-first_initial');
    await fireEvent.press(screen.getByTestId('names-first_initial'));
    await waitFor(() => expect(isSelected(screen.getByTestId('names-first_initial'))).toBe(true));

    const expected = { name: 'Nuevo CF', category: 'Alevín', defaultFormat: 'F11', defaultFormation: '4-4-2', displayNameMode: 'first_initial' };
    expect(await repo.getTeam()).toMatchObject(expected);
    const third = await makeService(createInMemorySquadRepository({ storage })).load();
    expect(third.team).toMatchObject(expected);
    expect(third.players).toHaveLength(3);
  });

  it('si el repositorio rechaza la escritura, el chip no cambia y se muestra el error', async () => {
    const inner = createInMemorySquadRepository();
    let failing = false;
    const repo: SquadRepository = { ...inner, saveTeam: (team) => (failing ? Promise.reject(new Error('disco lleno')) : inner.saveTeam(team)) };
    const service = await seed(repo);
    const screen = await render(<TeamScreen service={service} />);
    await screen.findByTestId('team-name');

    failing = true;
    await fireEvent.press(screen.getByTestId('format-F8'));
    expect(await screen.findByTestId('team-save-error')).toHaveTextContent('No se pudo guardar el equipo: disco lleno');
    expect(isSelected(screen.getByTestId('format-F7'))).toBe(true);
    expect(isSelected(screen.getByTestId('format-F8'))).toBe(false);
    expect((await inner.getTeam())?.defaultFormat).toBe('F7');
  });
});
