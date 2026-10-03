import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { reduceMatch, substitutionLog } from '../../../core';
import { EventFactory, T0 } from '../../../core/__tests__/helpers';
import { DEMO_BENCH, DEMO_CONFIG, DEMO_LINEUP, createDemoSession, prepareDemo } from '../createDemoSession';
import { benchElapsedMs } from '../derived';
import { fieldTokenCenter } from '../geometry';
import { LiveMatchScreen } from '../LiveMatchScreen';
import { fieldTokenLayouts, resolveDrop } from '../resolveDrop';

/**
 * Revisión: secuencia completa de partido con temporizadores falsos sobre la
 * pantalla real (reloj, fichas, etiquetas, deshacer y resumen) y los casos
 * que demostraron fallos concretos, ya corregidos (regresión).
 */
jest.useFakeTimers();

async function renderScreen(): Promise<RenderResult> {
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
  return screen;
}

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const press = (screen: RenderResult, testID: string) => fireEvent.press(screen.getByTestId(testID));
const hold = (screen: RenderResult, testID: string) => fireEvent(screen.getByTestId(testID), 'longPress');

describe('Revisión: secuencia completa en la pantalla', () => {
  it('reloj, fichas, etiquetas, deshacer y resumen cuadran a lo largo de un partido con pausa, descanso y 2ª parte', async () => {
    const screen = await renderScreen();

    // Pitido inicial y 65 s de juego.
    await press(screen, 'main-button');
    await advance(65_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:05');

    // Hugo (banquillo) entra por Lucas (campo) por selección con toques.
    await press(screen, 'token-hugo');
    await press(screen, 'token-lucas');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Hugo ⇄ Lucas');
    expect(within(screen.getByTestId('bench')).getByTestId('token-lucas')).toBeTruthy();

    // 30 s más: Hugo suma 30 s, Lucas se queda en 01:05.
    await advance(30_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:35');
    expect(screen.getByTestId('token-time-hugo')).toHaveTextContent('00:30');
    expect(screen.getByTestId('token-time-lucas')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-marco')).toHaveTextContent('01:35');
    // Tiempo seguido en el banquillo de Lucas: 30 s → 0'.
    expect(screen.getByTestId('token-lucas')).toHaveTextContent(/⏱ 0'/);

    // PAUSA de 20 s: nadie suma y la etiqueta cambia.
    await press(screen, 'main-button');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Pausa');
    expect(screen.getByTestId('period')).toHaveTextContent('PAUSA');
    await advance(20_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:35');
    expect(screen.getByTestId('token-time-hugo')).toHaveTextContent('00:30');

    // REANUDAR + 10 s.
    await press(screen, 'main-button');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Reanudar');
    await advance(10_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:45');
    expect(screen.getByTestId('token-time-hugo')).toHaveTextContent('00:40');

    // DESCANSO (mantener pulsado) de 60 s: congelado y botón 2ª PARTE.
    await press(screen, 'menu-button');
    await hold(screen, 'halftime-button');
    expect(screen.getByTestId('period')).toHaveTextContent('DESCANSO');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Descanso');
    expect(screen.getByTestId('main-button')).toHaveTextContent('2ª PARTE');
    await advance(60_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:45');

    // 2ª PARTE + 30 s: el reloj grande sigue acumulado (no vuelve a 25:00).
    await press(screen, 'main-button');
    expect(screen.getByTestId('period')).toHaveTextContent('2ª');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('2ª parte');
    await advance(30_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('02:15');
    expect(screen.getByTestId('token-time-hugo')).toHaveTextContent('01:10');
    expect(screen.getByTestId('token-time-lucas')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-marco')).toHaveTextContent('02:15');

    // En la última parte el menú no ofrece DESCANSO; FINALIZAR abre el resumen.
    await press(screen, 'menu-button');
    expect(screen.queryByTestId('halftime-button')).toBeNull();
    await hold(screen, 'end-button');
    expect(screen.getByTestId('period')).toHaveTextContent('FINAL');

    // Resumen: orden de convocatoria, minutos, % y cambios.
    const rows = screen.getAllByTestId(/^summary-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual([
      'summary-row-hugo',
      'summary-row-lucas',
      'summary-row-mateo',
      'summary-row-leo',
      'summary-row-daniel',
      'summary-row-pablo',
      'summary-row-alex',
      'summary-row-marco',
      'summary-row-adrian',
      'summary-row-david',
    ]);
    expect(screen.getByTestId('summary-row-marco')).toHaveTextContent(/02:15/);
    expect(screen.getByTestId('summary-row-marco')).toHaveTextContent(/100%/);
    expect(screen.getByTestId('summary-row-hugo')).toHaveTextContent(/01:10/);
    expect(screen.getByTestId('summary-row-hugo')).toHaveTextContent(/52%/);
    expect(screen.getByTestId('summary-row-lucas')).toHaveTextContent(/01:05/);
    expect(screen.getByTestId('summary-row-lucas')).toHaveTextContent(/●/);
    expect(screen.getByTestId('summary')).toHaveTextContent(/01:05\s+↓ Lucas\s+↑ Hugo/);
    expect(screen.getByTestId('summary')).toHaveTextContent(/02:15 real/);

    // El reloj no sigue tras el final aunque pasen los ticks.
    await advance(30_000);
    await press(screen, 'summary-close');
    expect(screen.getByTestId('clock')).toHaveTextContent('02:15');
    expect(screen.getByTestId('main-button')).toHaveTextContent('RESUMEN');

    // "Reabrir" = deshacer el final (docs/03 §3.1).
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Final');
    await press(screen, 'undo');
    expect(screen.getByTestId('period')).toHaveTextContent('2ª');
    expect(screen.getByTestId('main-button')).toHaveTextContent('PAUSA');
  });

  it('tiempo añadido: aparece al superar la duración del periodo, se mantiene en PAUSA y se oculta en el descanso', async () => {
    const screen = await renderScreen();
    await press(screen, 'main-button');
    await advance(25 * 60_000 + 83_000);
    expect(screen.getByTestId('added-time')).toHaveTextContent('+01:23');
    expect(screen.getByTestId('clock')).toHaveTextContent('26:23');

    await press(screen, 'main-button'); // PAUSA
    await advance(5_000);
    expect(screen.getByTestId('added-time')).toHaveTextContent('+01:23');

    await press(screen, 'menu-button');
    await hold(screen, 'halftime-button');
    expect(screen.queryByTestId('added-time')).toBeNull();

    // 2ª parte: el añadido se mide contra el reloj del periodo 2, no del total.
    await press(screen, 'main-button');
    await advance(60_000);
    expect(screen.queryByTestId('added-time')).toBeNull();
    expect(screen.getByTestId('clock')).toHaveTextContent('27:23');
  });

  it('deshacer con el rótulo desfasado: el motor rechaza y se avisa (expectedTargetId)', async () => {
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
    await press(screen, 'main-button');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Inicio');

    // Entra otro gesto "por detrás" sin que la pantalla lo vea aún: el botón
    // sigue apuntando a MATCH_STARTED y el motor debe negarse.
    const shown = session.engine.peekUndo();
    const pending = session.engine.pause();
    const rejected = session.engine.undo(undefined, shown?.id);
    await act(async () => {
      await pending;
      await expect(rejected).rejects.toMatchObject({ name: 'MatchRuleError', code: 'INVALID_EVENT' });
    });
    expect(session.engine.getState().status).toBe('PAUSED');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Pausa');
  });
});

describe('Revisión: fallos demostrados y corregidos (regresión)', () => {
  it('el tiempo en banquillo no debe seguir corriendo en PAUSA ni en DESCANSO', async () => {
    let t = 1_000_000;
    const { session } = createDemoSession({ now: () => t });
    const { engine } = session;
    await prepareDemo(session);
    await engine.start();
    t += 65_000;
    await engine.substitute('hugo', 'lucas');
    t += 30_000; // Lucas lleva 30 s fuera con el reloj en marcha.
    await engine.pause();
    t += 600_000; // 10 min de pausa: nadie juega, nadie "espera".
    expect(benchElapsedMs(engine.getState(), 'lucas', t)).toBe(30_000);
    await engine.startHalftime();
    t += 900_000; // 15 min de descanso.
    expect(benchElapsedMs(engine.getState(), 'lucas', t)).toBe(30_000);
    await engine.startNextPeriod();
    t += 10_000;
    expect(benchElapsedMs(engine.getState(), 'lucas', t)).toBe(40_000);
  });

  it('en la pantalla, la ficha del banquillo no infla su ⏱ durante el descanso', async () => {
    const screen = await renderScreen();
    await press(screen, 'main-button');
    await advance(65_000);
    await press(screen, 'token-hugo');
    await press(screen, 'token-lucas');
    await advance(30_000);
    await press(screen, 'menu-button');
    await hold(screen, 'halftime-button');
    await advance(15 * 60_000);
    // Antes mostraba "⏱ 15'" (tiempo real) aunque el reloj del partido no se movió.
    expect(screen.getByTestId('token-lucas')).toHaveTextContent(/⏱ 0'/);
  });

  it('un cambio hecho antes del pitido (edición de alineación) no aparece en "Cambios" del resumen', async () => {
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

    // En READY, Hugo (banquillo) por Lucas (campo): solo edita la alineación.
    await press(screen, 'token-hugo');
    await press(screen, 'token-lucas');
    expect(session.engine.getState().status).toBe('READY');
    expect(within(screen.getByTestId('pitch')).getByTestId('token-hugo')).toBeTruthy();

    await press(screen, 'main-button');
    await advance(60_000);
    await press(screen, 'menu-button');
    await hold(screen, 'end-button');

    // El reductor lo trata como alineación (Hugo titular con 0 entradas, Lucas ni titular ni minutos)…
    expect(session.engine.getState().players.hugo).toMatchObject({ wasStarter: true, entries: 0 });
    expect(screen.getByTestId('summary-row-hugo')).toHaveTextContent(/●/);
    expect(screen.getByTestId('summary-row-lucas')).not.toHaveTextContent(/●/);
    // …el log del núcleo sigue siendo una proyección cruda (lo lista con periodo 0)…
    expect(substitutionLog(session.engine.getTimeline())).toMatchObject([{ period: 0, matchTimeMs: 0, inPlayerId: 'hugo', outPlayerId: 'lucas' }]);
    // …y la pantalla lo filtra: antes pintaba "00:00 ↓ Lucas ↑ Hugo".
    expect(screen.getByTestId('summary')).not.toHaveTextContent(/↓ Lucas/);
    expect(screen.getByTestId('summary')).toHaveTextContent(/Sin cambios/);
  });

  it('recolocar una ficha del campo unos píxeles debe ser "mover", no un rechazo silencioso', () => {
    const PITCH = { x: 10, y: 100, width: 340, height: 500 };
    const ev = new EventFactory('demo');
    const state = reduceMatch(DEMO_CONFIG, [
      ev.make('LINEUP_SET', T0, { metadata: { field: [...DEMO_LINEUP], bench: [...DEMO_BENCH] } }),
    ]);
    const layout = { pitch: PITCH, bench: null, tokens: fieldTokenLayouts(state, PITCH) };
    const position = state.players.lucas?.position;
    if (!position) throw new Error('Lucas debería estar en el campo');
    const local = fieldTokenCenter(position, PITCH);
    const c = { x: PITCH.x + local.x, y: PITCH.y + local.y };
    // 30 px es más que el umbral de arrastre (8 dp) y menos que el imán (38 px):
    // la propia ficha queda fuera del imán y es un "move".
    const action = resolveDrop({ origin: { playerId: 'lucas', from: 'FIELD' }, point: { x: c.x + 30, y: c.y }, layout, state });
    expect(action.kind).toBe('move');
  });
});
