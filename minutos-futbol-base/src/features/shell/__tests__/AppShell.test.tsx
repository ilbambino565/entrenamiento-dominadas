import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createSquadService, type SquadService } from '../../../app-services/squadService';
import { GOALKEEPER_SLOT, formationSlots } from '../../../core/formations';
import type { PlayerDraft } from '../../../core/team';
import { createInMemoryEventStore } from '../../../db/inMemoryEventStore';
import { createInMemoryMatchRepository } from '../../../db/inMemoryMatchRepository';
import { createInMemorySquadRepository } from '../../../db/inMemorySquadRepository';
import { fieldTokenCenter, fieldTokenMetrics, fitPitch } from '../../live-match/geometry';
import { AppShell } from '../AppShell';
import { firstTeamDraft } from '../FirstRunScreen';
import type { Persistence } from '../persistence';

/**
 * Shell completo con el servicio REAL sobre el repositorio en memoria (sin
 * storage), reloj e ids inyectados. Nombres inventados: el repositorio es
 * público y los datos reales son de menores. RNTL 14: `render` y `fireEvent`
 * se esperan; los cambios que pasan por el repositorio se esperan con
 * `findBy*`.
 */
jest.useFakeTimers();

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const now = () => Date.now();
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
/** Elemento tal y como lo devuelve RNTL 14 (su propio renderizador, no react-test-renderer). */
type Instance = ReturnType<RenderResult['getByTestId']>;
const selected = (el: Instance) => (el.props as { accessibilityState?: { selected?: boolean } }).accessibilityState?.selected;

const persistences = new WeakMap<SquadService, Persistence>();

function makeService(): SquadService {
  let n = 0;
  const squad = createInMemorySquadRepository();
  const service = createSquadService({ repo: squad, now, newId: () => `id-${String(++n).padStart(3, '0')}` });
  persistences.set(service, { squad, matches: createInMemoryMatchRepository(), events: createInMemoryEventStore() });
  return service;
}

const persistenceOf = (service: SquadService): Persistence => {
  const persistence = persistences.get(service);
  if (!persistence) throw new Error('Servicio sin persistencia de prueba');
  return persistence;
};

async function renderShell(service: SquadService): Promise<RenderResult> {
  return render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppShell service={service} persistence={persistenceOf(service)} now={now} />
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
}

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

/** Equipo del primer arranque con una plantilla con dorsales 1..n (portero: el indicado). */
async function seedTeam(service: SquadService, names: readonly string[], goalkeeper?: string): Promise<void> {
  await service.load();
  await service.createTeam(firstTeamDraft('CD Prueba'));
  for (const [i, name] of names.entries()) {
    await service.addPlayer(draft(name, { shirtNumber: i + 1, isGoalkeeper: name === goalkeeper }));
  }
}

function idOf(service: SquadService, firstName: string): string {
  const player = service.getState().players.find((p) => p.firstName === firstName);
  if (!player) throw new Error(`No hay jugador ${firstName}`);
  return player.id;
}

/** Contenedor del campo: el primer ancestro con un `onLayout` distinto del propio del campo (el que fija su tamaño). */
function pitchOuter(pitch: Instance): Instance {
  const own: unknown = pitch.props.onLayout;
  let node = pitch.parent;
  while (node && (typeof node.props.onLayout !== 'function' || node.props.onLayout === own)) node = node.parent;
  if (!node) throw new Error('No se encontró el contenedor del campo');
  return node;
}

/** left/top de la ficha en el campo: el primer ancestro con posición absoluta (la vista que la coloca). */
function tokenOffset(screen: RenderResult, id: string): { left: number; top: number } {
  let node: Instance | null = screen.getByTestId(`token-${id}`);
  while (node) {
    const style = flat(node.props.style);
    if (style?.position === 'absolute') return { left: Number(style.left), top: Number(style.top) };
    node = node.parent;
  }
  throw new Error(`La ficha ${id} no está colocada en el campo`);
}

async function waitForStatus(persistence: Persistence, matchId: string, status: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((await persistence.matches.getMatch(matchId))?.status === status) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(`El partido no llegó a ${status}`);
}

/** JUGAR PARTIDO → P5 (rival) → P6 (todos) → P7 (alineación por defecto) → INICIAR PARTIDO → P8. */
async function playThroughWizard(screen: RenderResult, opponent = 'Rival Prueba'): Promise<void> {
  await fireEvent.press(await screen.findByTestId('play-match'));
  await fireEvent.changeText(await screen.findByTestId('setup-opponent'), opponent);
  await fireEvent.press(screen.getByTestId('setup-continue'));
  await fireEvent.press(await screen.findByTestId('convocation-continue'));
  await fireEvent.press(await screen.findByTestId('lineup-start'));
}

const setPack = (pack: unknown) => {
  (globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__ = pack;
};

beforeEach(() => {
  jest.setSystemTime(T0);
});

afterEach(() => {
  delete (globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__;
});

describe('AppShell — primer arranque', () => {
  it('sin equipo ni paquete: crear el equipo abre Plantilla vacía y un alta aparece en la lista', async () => {
    const service = makeService();
    const screen = await renderShell(service);

    const nameInput = await screen.findByTestId('first-run-name');
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await fireEvent.changeText(nameInput, 'CD Prueba');
    await fireEvent.press(screen.getByTestId('first-run-start'));

    expect(await screen.findByTestId('squad-title')).toHaveTextContent('Plantilla (0)');
    expect(selected(screen.getByTestId('tab-squad'))).toBe(true);
    expect(selected(screen.getByTestId('tab-matches'))).toBe(false);
    expect(service.getState().team).toMatchObject({
      name: 'CD Prueba',
      defaultFormat: 'F7',
      periodsCount: 2,
      periodDurationMs: 25 * MINUTE,
      displayNameMode: 'first',
    });

    // '+' → ficha (sin pestañas) → GUARDAR → vuelve a la lista con el jugador.
    await fireEvent.press(screen.getByTestId('add-player-empty'));
    const firstName = await screen.findByTestId('first-name');
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await fireEvent.changeText(firstName, 'Ana');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '1');
    await fireEvent.press(screen.getByTestId('save'));

    expect(await screen.findByTestId('squad-title')).toHaveTextContent('Plantilla (1)');
    const row = screen.getByTestId(`player-row-${idOf(service, 'Ana')}`);
    expect(within(row).getByTestId(/^player-name-/)).toHaveTextContent('Ana');
    expect(selected(screen.getByTestId('tab-squad'))).toBe(true);
  });

  it('EMPEZAR con el nombre en blanco no crea el equipo y muestra el motivo', async () => {
    const service = makeService();
    const screen = await renderShell(service);
    await screen.findByTestId('first-run-name');
    await fireEvent.press(screen.getByTestId('first-run-start'));
    expect(await screen.findByTestId('first-run-error')).toHaveTextContent(/nombre del equipo es obligatorio/);
    expect(service.getState().team).toBeNull();
    expect(screen.getByTestId('first-run-name')).toBeTruthy();
  });

  it('las pestañas miden al menos 56 dp, son "tab" con estado seleccionado y cambian de pantalla', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana']);
    const screen = await renderShell(service);
    const matches = await screen.findByTestId('tab-matches');
    for (const id of ['tab-matches', 'tab-squad', 'tab-team']) {
      const tab = screen.getByTestId(id);
      expect(tab.props.accessibilityRole).toBe('tab');
      expect(flat(tab.props.style).minHeight).toBeGreaterThanOrEqual(56);
    }
    expect(selected(matches)).toBe(true);

    await fireEvent.press(screen.getByTestId('tab-team'));
    expect(screen.getByTestId('team-name').props.value).toBe('CD Prueba');
    expect(selected(screen.getByTestId('tab-team'))).toBe(true);
    expect(screen.queryByTestId('play-match')).toBeNull();

    await fireEvent.press(screen.getByTestId('tab-squad'));
    expect(screen.getByTestId('squad-title')).toHaveTextContent('Plantilla (1)');
  });
});

describe('AppShell — partido con la plantilla real', () => {
  it('JUGAR PARTIDO abre el campo con las fichas de la plantilla; SALIR (⋯, en READY) vuelve a Partidos', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea', 'Cris', 'Dani', 'Eva', 'Fran', 'Gael', 'Hugo'], 'Ana');
    const screen = await renderShell(service);

    const play = await screen.findByTestId('play-match');
    expect(screen.getByTestId('home-team-name')).toHaveTextContent('CD Prueba');
    expect(play).toHaveTextContent('JUGAR PARTIDO');
    expect(flat(play.props.style).minHeight).toBeGreaterThanOrEqual(64);
    expect(play.props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByTestId('play-hint')).toBeNull();
    expect(screen.getByTestId('play-note')).toHaveTextContent(/Juegan 7 en el campo; la alineación propuesta usa el dibujo\s*2-3-1/);

    await playThroughWizard(screen);
    const pitch = await screen.findByTestId('pitch');
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    expect(within(pitch).getAllByTestId(/^token-id-\d+$/)).toHaveLength(7);
    expect(within(pitch).getByTestId(`token-${idOf(service, 'Ana')}`)).toBeTruthy();
    expect(within(screen.getByTestId('bench')).getByTestId(`token-${idOf(service, 'Hugo')}`)).toBeTruthy();
    expect(screen.getByTestId('team-line')).toHaveTextContent(/CD Prueba/);
    expect(screen.getByTestId('main-button')).toHaveTextContent('INICIAR');
    // Modo de nombres 'first': la ficha anuncia solo el nombre de pila y el dorsal real.
    expect(screen.getByTestId(`token-${idOf(service, 'Ana')}`).props.accessibilityLabel).toMatch(/^Ana, dorsal 1, en el campo/);

    await fireEvent.press(screen.getByTestId('menu-button'));
    const exit = screen.getByTestId('exit-button');
    expect(exit).toHaveTextContent('SALIR');
    await fireEvent(exit, 'longPress');

    expect(await screen.findByTestId('play-match')).toBeTruthy();
    expect(screen.queryByTestId('pitch')).toBeNull();
    expect(selected(screen.getByTestId('tab-matches'))).toBe(true);
  });

  it('sin jugadores activos el botón está deshabilitado y pide añadirlos en Plantilla', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana']);
    await service.updatePlayer(idOf(service, 'Ana'), { isActive: false });
    const screen = await renderShell(service);

    const play = await screen.findByTestId('play-match');
    expect(play.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('play-hint')).toHaveTextContent('Añade jugadores en Plantilla');
    await fireEvent.press(play);
    expect(screen.queryByTestId('pitch')).toBeNull();
    expect(screen.queryByTestId('setup-opponent')).toBeNull();
  });
});

describe('AppShell — crear partido (P5-P7) y persistencia', () => {
  it('el asistente guarda el partido con rival, convocatoria y alineación, y el progreso sigue al reloj', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea', 'Cris', 'Dani', 'Eva', 'Fran', 'Gael', 'Hugo', 'Iris'], 'Ana');
    const persistence = persistenceOf(service);
    const screen = await renderShell(service);

    await fireEvent.press(await screen.findByTestId('play-match'));
    expect(screen.getByTestId('setup-step')).toHaveTextContent('1 / 3');
    expect(screen.queryByTestId('tab-bar')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), 'CD Rival');
    await fireEvent.press(screen.getByTestId('setup-continue'));

    expect(await screen.findByTestId('convocation-step')).toHaveTextContent('2 / 3');
    await fireEvent.press(screen.getByTestId(`convocation-row-${idOf(service, 'Iris')}`));
    await fireEvent.press(screen.getByTestId('convocation-continue'));

    expect(await screen.findByTestId('lineup-step')).toHaveTextContent('3 / 3');
    expect(await screen.findByTestId('pitch')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lineup-start'));
    await screen.findByTestId('main-button');

    const [match] = await persistence.matches.listRecentMatches();
    expect(match).toMatchObject({ opponent: 'CD Rival', format: 'F7', playersOnField: 7, periodsCount: 2, periodDurationMs: 25 * MINUTE });
    const convocated = await persistence.matches.listMatchPlayers(match!.id);
    expect(convocated.map((c) => c.playerId)).toEqual(['Ana', 'Bea', 'Cris', 'Dani', 'Eva', 'Fran', 'Gael', 'Hugo'].map((n) => idOf(service, n)));
    expect(convocated.filter((c) => c.inInitialLineup)).toHaveLength(7);
    expect(convocated.find((c) => c.playerId === idOf(service, 'Hugo'))).toMatchObject({ inInitialLineup: false, benchOrder: 1 });
    expect(convocated.find((c) => c.playerId === idOf(service, 'Ana'))).toMatchObject({ isGoalkeeper: true, shirtNumber: 1 });

    // La alineación pasa a READY y, al iniciar, RUNNING con su marca de inicio.
    await waitForStatus(persistence, match!.id, 'READY');
    await fireEvent.press(screen.getByTestId('main-button'));
    await waitForStatus(persistence, match!.id, 'RUNNING');
    expect(await persistence.matches.getMatch(match!.id)).toMatchObject({ currentPeriod: 1, startedAt: T0 });
    expect((await persistence.events.loadEvents(match!.id)).length).toBeGreaterThan(0);
  });

  it('← desde cada paso vuelve al anterior y desde P5 a Partidos, sin crear nada', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea', 'Cris'], 'Ana');
    const persistence = persistenceOf(service);
    const screen = await renderShell(service);

    await fireEvent.press(await screen.findByTestId('play-match'));
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), 'CD Rival');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    await fireEvent.press(await screen.findByTestId('convocation-continue'));
    await fireEvent.press(await screen.findByTestId('lineup-back'));
    expect(await screen.findByTestId('convocation-step')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('convocation-back'));
    expect(await screen.findByTestId('setup-opponent')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-back'));
    expect(await screen.findByTestId('play-match')).toBeTruthy();
    expect(await persistence.matches.listRecentMatches()).toEqual([]);
  });

  it('si no se puede guardar el partido, P7 sigue abierta con el aviso y permite reintentar', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea', 'Cris'], 'Ana');
    const persistence = persistenceOf(service);
    const createMatch = jest.spyOn(persistence.matches, 'createMatch').mockRejectedValueOnce(new Error('disco lleno'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const screen = await renderShell(service);

    await playThroughWizard(screen);
    expect(await screen.findByTestId('lineup-start-error')).toHaveTextContent(/No se pudo guardar el partido/);
    expect(screen.queryByTestId('main-button')).toBeNull();
    expect(await persistence.matches.listRecentMatches()).toEqual([]);

    await fireEvent.press(screen.getByTestId('lineup-start'));
    expect(await screen.findByTestId('main-button')).toBeTruthy();
    expect(createMatch).toHaveBeenCalledTimes(2);
    expect(await persistence.matches.listRecentMatches()).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('AppShell — siembra con paquete de equipo', () => {
  it('el primer arranque importa el paquete y el partido coloca a los titulares en su dibujo', async () => {
    setPack({
      teamName: 'CD Paquete',
      formation: '3-1-2',
      starters: ['ana', 'bea', 'cris', 'dani', 'eva', 'fran', 'gael'],
      players: [
        { id: 'ana', name: 'Ana', number: 2 },
        { id: 'bea', name: 'Bea', number: 3 },
        { id: 'cris', name: 'Cris', number: 1, isGoalkeeper: true },
        { id: 'dani', name: 'Dani', number: 4 },
        { id: 'eva', name: 'Eva', number: 5 },
        { id: 'fran', name: 'Fran', number: 6 },
        { id: 'gael', name: 'Gael', number: 7 },
        { id: 'hugo', name: 'Hugo', number: 8 },
        { id: 'iris', name: 'Iris', number: 9 },
      ],
    });
    const service = makeService();
    const screen = await renderShell(service);

    expect(await screen.findByTestId('home-team-name')).toHaveTextContent('CD Paquete');
    expect(screen.queryByTestId('first-run-name')).toBeNull();
    expect(service.getState().players.map((p) => p.firstName)).toEqual(['Ana', 'Bea', 'Cris', 'Dani', 'Eva', 'Fran', 'Gael', 'Hugo', 'Iris']);
    expect(service.getState().team?.defaultFormation).toBe('3-1-2');
    expect(screen.getByTestId('play-note')).toHaveTextContent(/dibujo\s*3-1-2/);

    await playThroughWizard(screen);
    const pitch = await screen.findByTestId('pitch');
    expect(within(pitch).getAllByTestId(/^token-id-\d+$/)).toHaveLength(7);
    expect(within(screen.getByTestId('bench')).getAllByTestId(/^token-id-\d+$/)).toHaveLength(2);

    // El campo coloca las fichas con su tamaño medido: se simula el layout y
    // se comparan left/top con la misma geometría que usa la pantalla.
    const available = { width: 400, height: 600 };
    await act(async () => {
      pitchOuter(pitch).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...available } } });
    });
    const size = fitPitch(available);
    const metrics = fieldTokenMetrics(size);
    const expectedAt = (position: { x: number; y: number }) => {
      const c = fieldTokenCenter(position, size, metrics);
      return { left: c.x - metrics.columnWidth / 2, top: c.y - metrics.radius };
    };
    const slots = formationSlots('3-1-2');
    // Titulares de campo en orden del paquete (Ana, Bea, Dani, Eva, Fran, Gael) sobre los huecos del
    // 3-1-2 (defensa, medio, ataque): Ana la primera de la defensa, Eva sola en el medio; la portera en su área.
    expect(tokenOffset(screen, idOf(service, 'Ana'))).toEqual(expectedAt(slots[0]!));
    expect(tokenOffset(screen, idOf(service, 'Eva'))).toEqual(expectedAt(slots[3]!));
    expect(tokenOffset(screen, idOf(service, 'Eva')).top).toBeGreaterThan(tokenOffset(screen, idOf(service, 'Gael')).top);
    expect(tokenOffset(screen, idOf(service, 'Cris'))).toEqual(expectedAt(GOALKEEPER_SLOT));
    expect(screen.getByTestId(`token-${idOf(service, 'Cris')}`).props.accessibilityLabel).toMatch(/^Cris, dorsal 1, en el campo/);
  });

  it('un paquete no pisa un equipo ya creado ni se vuelve a importar', async () => {
    setPack({ teamName: 'CD Paquete', players: [{ id: 'zoe', name: 'Zoe', number: 10 }] });
    const service = makeService();
    await seedTeam(service, ['Ana']);
    const screen = await renderShell(service);
    expect(await screen.findByTestId('home-team-name')).toHaveTextContent('CD Prueba');
    expect(service.getState().players.map((p) => p.firstName)).toEqual(['Ana']);
  });
});

describe('AppShell — edición desde la lista y segundo partido', () => {
  it('tocar una fila abre la ficha precargada; GUARDAR el dorsal lo muestra en la lista', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea'], 'Ana');
    const screen = await renderShell(service);
    await fireEvent.press(await screen.findByTestId('tab-squad'));
    await fireEvent.press(await screen.findByTestId(`player-row-${idOf(service, 'Bea')}`));
    expect(await screen.findByTestId('player-form-title')).toHaveTextContent('Jugador');
    expect(screen.getByTestId('first-name').props.value).toBe('Bea');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '9');
    await fireEvent.press(screen.getByTestId('save'));
    expect(await screen.findByTestId('squad-title')).toHaveTextContent('Plantilla (2)');
    expect(screen.getByTestId(`player-number-${idOf(service, 'Bea')}`)).toHaveTextContent('#9');
    expect(service.getState().players.find((p) => p.firstName === 'Bea')?.shirtNumber).toBe(9);
  });

  it('en modo Ordenar tocar la fila (o su flecha deshabilitada) no abre la ficha', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea'], 'Ana');
    const screen = await renderShell(service);
    await fireEvent.press(await screen.findByTestId('tab-squad'));
    await fireEvent.press(await screen.findByTestId('toggle-reorder'));
    await fireEvent.press(screen.getByTestId(`move-up-${idOf(service, 'Ana')}`));
    await fireEvent.press(screen.getByTestId(`player-row-${idOf(service, 'Ana')}`));
    expect(screen.queryByTestId('player-form-title')).toBeNull();
    expect(screen.getByTestId('squad-title')).toHaveTextContent('Plantilla (2)');
  });

  it('un segundo partido arranca de cero con la plantilla actual', async () => {
    const service = makeService();
    await seedTeam(service, ['Ana', 'Bea', 'Cris'], 'Ana');
    const screen = await renderShell(service);
    await playThroughWizard(screen);
    await screen.findByTestId('pitch');
    await fireEvent.press(screen.getByTestId('menu-button'));
    await fireEvent(screen.getByTestId('exit-button'), 'longPress');
    await screen.findByTestId('play-match');
    await act(async () => {
      await service.addPlayer(draft('Dani', { shirtNumber: 4 }));
    });
    await playThroughWizard(screen, 'Otro Rival');
    const pitch = await screen.findByTestId('pitch');
    expect(within(pitch).getByTestId(`token-${idOf(service, 'Dani')}`)).toBeTruthy();
    expect(screen.getByTestId('main-button')).toHaveTextContent('INICIAR');
    expect(screen.getByTestId('team-line')).toHaveTextContent(/CD Prueba/);
    expect(screen.getByTestId('team-line')).toHaveTextContent(/Otro Rival/);
  });
});
