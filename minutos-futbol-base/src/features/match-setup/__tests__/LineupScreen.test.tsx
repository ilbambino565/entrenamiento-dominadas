import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Player } from '../../../core/team';
import { LineupScreen, type LineupScreenProps } from '../LineupScreen';

/**
 * P7 con una plantilla inventada. Reanimated y gesture-handler van mockeados:
 * los movimientos se hacen por toques (ficha del banquillo + ficha del campo).
 */
jest.useFakeTimers();

const NAMES = ['Ana', 'Bea', 'Cris', 'Dani', 'Eli', 'Fran', 'Gema', 'Hana', 'Inés', 'Jara'];
const player = (n: number, overrides: Partial<Player> = {}): Player => ({
  id: `p${n}`,
  teamId: 't',
  firstName: NAMES[n - 1] ?? `J${n}`,
  lastName: null,
  shirtNumber: n,
  isGoalkeeper: n === 1,
  isActive: true,
  photoUri: null,
  photoConsent: false,
  sortOrder: n,
  createdAt: n,
  updatedAt: n,
  deletedAt: null,
  ...overrides,
});
const squad = Array.from({ length: 10 }, (_, i) => player(i + 1));
const ALL = squad.map((p) => p.id);

async function renderScreen(overrides: Partial<LineupScreenProps> = {}) {
  const onStart = jest.fn();
  const onBack = jest.fn();
  const screen = await render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LineupScreen
          team={{ defaultFormation: null, periodsCount: 2, periodDurationMs: 25 * 60_000, displayNameMode: 'full' }}
          players={squad}
          convocated={ALL.slice(0, 9)}
          playersOnField={7}
          onStart={onStart}
          onBack={onBack}
          {...overrides}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId('pitch');
  return { screen, onStart, onBack };
}

const tokensIn = (screen: RenderResult, zone: 'pitch' | 'bench') => within(screen.getByTestId(zone)).getAllByTestId(/^token-p\d+$/).map((t) => t.props.testID as string);

describe('LineupScreen (P7)', () => {
  it('pone a los 7 primeros convocados en el campo, el resto en el banquillo, y muestra 7 / 7 y paso 3 / 3', async () => {
    const { screen } = await renderScreen();
    expect(tokensIn(screen, 'pitch').sort()).toEqual(['token-p1', 'token-p2', 'token-p3', 'token-p4', 'token-p5', 'token-p6', 'token-p7']);
    expect(tokensIn(screen, 'bench')).toEqual(['token-p8', 'token-p9']);
    expect(screen.getByTestId('lineup-count')).toHaveTextContent('7 / 7');
    expect(screen.getByTestId('lineup-step')).toHaveTextContent('3 / 3');
    expect(screen.queryByTestId('lineup-issue')).toBeNull();
    // El jugador 10 no está convocado: no aparece.
    expect(screen.queryByTestId('token-p10')).toBeNull();
  });

  it('INICIAR PARTIDO entrega los titulares con posición, el portero marcado y el banquillo en orden', async () => {
    const { screen, onStart } = await renderScreen();
    await fireEvent.press(screen.getByTestId('lineup-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
    const [lineup, bench] = onStart.mock.calls[0] as [Array<{ playerId: string; position: { x: number; y: number }; goalkeeper?: boolean }>, string[]];
    expect(lineup.map((e) => e.playerId).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    expect(lineup.filter((e) => e.goalkeeper)).toEqual([expect.objectContaining({ playerId: 'p1' })]);
    for (const e of lineup) {
      expect(e.position.x).toBeGreaterThanOrEqual(0);
      expect(e.position.x).toBeLessThanOrEqual(1);
    }
    expect(bench).toEqual(['p8', 'p9']);
  });

  it('un cambio por toques (suplente → titular) se refleja en lo que entrega, y ese banquillo conserva el orden de convocatoria', async () => {
    const { screen, onStart } = await renderScreen();
    await fireEvent.press(screen.getByTestId('token-p9'));
    await fireEvent.press(screen.getByTestId('token-p3'));
    expect(tokensIn(screen, 'pitch')).toContain('token-p9');
    expect(tokensIn(screen, 'bench').sort()).toEqual(['token-p3', 'token-p8']);

    await fireEvent.press(screen.getByTestId('lineup-start'));
    const [lineup, bench] = onStart.mock.calls[0] as [Array<{ playerId: string }>, string[]];
    expect(lineup.map((e) => e.playerId)).toContain('p9');
    expect(lineup.map((e) => e.playerId)).not.toContain('p3');
    expect(bench).toEqual(['p3', 'p8']);
  });

  it('sacar a un titular deja 6 / 7, avisa que falta uno y deja iniciar', async () => {
    const { screen, onStart } = await renderScreen();
    await fireEvent.press(screen.getByTestId('token-p4'));
    await fireEvent.press(screen.getByTestId('bench'));
    expect(screen.getByTestId('lineup-count')).toHaveTextContent('6 / 7');
    expect(screen.getByTestId('lineup-issue')).toHaveTextContent('Faltan 1 para completar el campo de 7');
    await fireEvent.press(screen.getByTestId('lineup-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect((onStart.mock.calls[0] as [unknown[], string[]])[1]).toEqual(['p4', 'p8', 'p9']);
  });

  it('con menos convocados que jugadores en campo, todos van al campo y avisa', async () => {
    const { screen } = await renderScreen({ convocated: ['p1', 'p2', 'p3'] });
    expect(tokensIn(screen, 'pitch')).toHaveLength(3);
    expect(screen.getByTestId('lineup-count')).toHaveTextContent('3 / 7');
    expect(screen.getByTestId('lineup-issue')).toHaveTextContent('Faltan 4 para completar el campo de 7');
  });

  it('sin nadie en el campo bloquea INICIAR y lo explica', async () => {
    const { screen, onStart } = await renderScreen({ convocated: [] });
    expect(screen.getByTestId('lineup-count')).toHaveTextContent('0 / 7');
    expect(screen.getByTestId('lineup-issue')).toHaveTextContent('Pon al menos un jugador en el campo');
    expect(screen.getByTestId('lineup-start').props.accessibilityState?.disabled ?? screen.getByTestId('lineup-start').props.disabled).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lineup-start'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('usa el dibujo del equipo si cuadra con el formato', async () => {
    const { screen, onStart } = await renderScreen({
      team: { defaultFormation: '3-2-1', periodsCount: 2, periodDurationMs: 25 * 60_000, displayNameMode: 'full' },
    });
    await fireEvent.press(screen.getByTestId('lineup-start'));
    const [lineup] = onStart.mock.calls[0] as [Array<{ playerId: string; position: { y: number }; goalkeeper?: boolean }>];
    const rows = new Set(lineup.filter((e) => !e.goalkeeper).map((e) => e.position.y));
    expect(rows.size).toBe(3);
  });

  it('← llama a onBack sin entregar nada', async () => {
    const { screen, onBack, onStart } = await renderScreen();
    await fireEvent.press(screen.getByTestId('lineup-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
