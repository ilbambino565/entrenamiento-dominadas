import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { MatchSession } from '../../../app-services/createMatchSession';
import { createDemoSession } from '../createDemoSession';
import { GOALKEEPER_SLOT, formationSlots } from '../formations';
import { LiveMatchScreen } from '../LiveMatchScreen';

jest.useFakeTimers();

async function renderScreen(): Promise<{ screen: RenderResult; session: MatchSession }> {
  const { session, players } = createDemoSession();
  const screen = await render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LiveMatchScreen session={session} players={players} />
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId('pitch');
  return { screen, session };
}

const fieldPositions = (session: MatchSession) =>
  Object.values(session.engine.getState().players)
    .filter((p) => p.location === 'FIELD' && !p.isGoalkeeper)
    .map((p) => p.position)
    .sort((a, b) => (b?.y ?? 0) - (a?.y ?? 0) || (a?.x ?? 0) - (b?.x ?? 0));

describe('selector de dibujo (⋯ → DIBUJO)', () => {
  it('antes del pitido, 3-2-1 reescribe la alineación en un solo evento: sigue en READY y se deshace de una vez', async () => {
    const { screen, session } = await renderScreen();
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.getByTestId('formations')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('formation-3-2-1'));
    await act(async () => {
      await Promise.resolve();
    });

    const state = session.engine.getState();
    expect(state.status).toBe('READY');
    expect(state.players.marco?.position).toEqual(GOALKEEPER_SLOT);
    expect(fieldPositions(session)).toEqual(formationSlots('3-2-1'));
    // Un único LINEUP_SET nuevo: DESHACER vuelve al 2-3-1 de la demo en un toque.
    expect(session.engine.getTimeline().filter((e) => e.type === 'LINEUP_SET')).toHaveLength(2);
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Alineación');
    await fireEvent.press(screen.getByTestId('undo'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(session.engine.getState().players.pablo?.position).toEqual({ x: 0.5, y: 0.22 });
    expect(session.engine.getState().players.lucas?.position).toEqual({ x: 0.2, y: 0.45 });
  });

  it('con el partido en marcha, el dibujo mueve fichas (eventos MOVE) sin tocar los minutos', async () => {
    const { screen, session } = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await fireEvent.press(screen.getByTestId('menu-button'));
    await fireEvent.press(screen.getByTestId('formation-2-2-2'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const state = session.engine.getState();
    expect(state.status).toBe('RUNNING');
    expect(fieldPositions(session)).toEqual(formationSlots('2-2-2'));
    const moves = session.engine.getTimeline().filter((e) => e.type === 'PLAYER_MOVED');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(6);
    expect(session.engine.playedMs('lucas', session.engine.getEvents().at(-1)?.timestamp)).toBe(
      session.engine.playedMs('marco', session.engine.getEvents().at(-1)?.timestamp),
    );
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Mover');
  });

  it('tras FINALIZAR no se ofrecen dibujos', async () => {
    const { screen } = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));
    await fireEvent.press(screen.getByTestId('menu-button'));
    await fireEvent(screen.getByTestId('end-button'), 'longPress');
    await act(async () => {
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId('summary-close'));
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('formations')).toBeNull();
  });
});
