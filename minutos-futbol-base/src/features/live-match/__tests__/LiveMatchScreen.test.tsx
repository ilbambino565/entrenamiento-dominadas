import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createDemoSession } from '../createDemoSession';
import { LiveMatchScreen } from '../LiveMatchScreen';

/**
 * Pantalla completa con el equipo de prueba. Reanimated y gesture-handler
 * van mockeados (jest.setup.js), así que el arrastre no se puede simular:
 * aquí se prueba la alternativa por toques, el reloj y los botones.
 */
jest.useFakeTimers();

async function renderScreen(onExit?: () => void): Promise<RenderResult> {
  const { session, players } = createDemoSession();
  const screen = await render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LiveMatchScreen session={session} players={players} onExit={onExit} />
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  // prepareDemo: load + setLineup en la cola serie del motor.
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId('pitch');
  return screen;
}

const tokensIn = (screen: RenderResult, zone: 'pitch' | 'bench') =>
  within(screen.getByTestId(zone)).getAllByTestId(/^token-[a-z]+$/);

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);

describe('LiveMatchScreen', () => {
  it('renderiza 7 fichas en el campo y 3 en el banquillo, reloj a 00:00 y botón INICIAR', async () => {
    const screen = await renderScreen();
    expect(tokensIn(screen, 'pitch')).toHaveLength(7);
    expect(tokensIn(screen, 'bench')).toHaveLength(3);
    expect(screen.getByTestId('clock')).toHaveTextContent('00:00');
    expect(screen.getByTestId('main-button')).toHaveTextContent('INICIAR');
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Alineación');
  });

  it('INICIAR arranca el reloj: a los 65 s marca 01:05 en el reloj y en los del campo, no en el banquillo', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));
    expect(screen.getByTestId('main-button')).toHaveTextContent('PAUSA');
    expect(screen.getByTestId('period')).toHaveTextContent('1ª');

    await advance(65_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-lucas')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-marco')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-hugo')).toHaveTextContent('00:00');
    expect(screen.getByTestId('token-time-david')).toHaveTextContent('00:00');

    // PAUSA congela el reloj y marca la etiqueta.
    await fireEvent.press(screen.getByTestId('main-button'));
    expect(screen.getByTestId('period')).toHaveTextContent('PAUSA');
    await advance(10_000);
    expect(screen.getByTestId('clock')).toHaveTextContent('01:05');
    expect(screen.getByTestId('main-button')).toHaveTextContent('REANUDAR');
  });

  it('selección por toques: Hugo (banquillo) y luego Lucas (campo) = sustitución; DESHACER la revierte', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));

    await fireEvent.press(screen.getByTestId('token-hugo'));
    expect(screen.getByTestId('token-hugo').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('token-lucas'));

    expect(within(screen.getByTestId('pitch')).getByTestId('token-hugo')).toBeTruthy();
    expect(within(screen.getByTestId('bench')).getByTestId('token-lucas')).toBeTruthy();
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Hugo ⇄ Lucas');

    await fireEvent.press(screen.getByTestId('undo'));
    expect(within(screen.getByTestId('bench')).getByTestId('token-hugo')).toBeTruthy();
    expect(within(screen.getByTestId('pitch')).getByTestId('token-lucas')).toBeTruthy();
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Inicio');
  });

  it('tocar la misma ficha la deselecciona; tocar el banquillo con un titular seleccionado lo saca', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('token-hugo'));
    await fireEvent.press(screen.getByTestId('token-hugo'));
    expect(screen.getByTestId('token-hugo').props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(screen.getByTestId('token-pablo'));
    await fireEvent.press(screen.getByTestId('bench'));
    expect(tokensIn(screen, 'pitch')).toHaveLength(6);
    expect(within(screen.getByTestId('bench')).getByTestId('token-pablo')).toBeTruthy();
    expect(screen.getByTestId('undo-label')).toHaveTextContent('Sale Pablo');
  });

  it('una regla incumplida se muestra como aviso y no rompe la pantalla', async () => {
    const screen = await renderScreen();
    // Dos del banquillo: Hugo seleccionado y luego Adrián → reordenar (nada). Luego
    // Hugo → zona libre del campo con el campo lleno → aviso.
    await fireEvent.press(screen.getByTestId('token-hugo'));
    await fireEvent.press(screen.getByTestId('pitch'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Suelta sobre un jugador para cambiar');
    await advance(2_600);
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(tokensIn(screen, 'pitch')).toHaveLength(7);
  });

  it('⋯ → mantener DESCANSO → 2ª PARTE → mantener FINALIZAR muestra el resumen con 10 filas', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));
    await advance(5_000);

    await fireEvent.press(screen.getByTestId('menu-button'));
    // Un toque corto solo enseña la pista.
    await fireEvent.press(screen.getByTestId('halftime-button'));
    expect(screen.getByTestId('hold-hint')).toBeTruthy();
    expect(screen.getByTestId('period')).toHaveTextContent('1ª');

    await fireEvent(screen.getByTestId('halftime-button'), 'longPress');
    expect(screen.getByTestId('period')).toHaveTextContent('DESCANSO');
    expect(screen.getByTestId('main-button')).toHaveTextContent('2ª PARTE');

    await fireEvent.press(screen.getByTestId('main-button'));
    expect(screen.getByTestId('period')).toHaveTextContent('2ª');
    await advance(3_000);

    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('halftime-button')).toBeNull();
    await fireEvent(screen.getByTestId('end-button'), 'longPress');

    expect(screen.getByTestId('period')).toHaveTextContent('FINAL');
    expect(screen.getAllByTestId(/^summary-row-/)).toHaveLength(10);
    expect(screen.getByTestId('summary-row-marco')).toHaveTextContent(/00:08/);
    expect(screen.getByTestId('summary-row-marco')).toHaveTextContent(/●/);

    await fireEvent.press(screen.getByTestId('summary-close'));
    expect(screen.queryByTestId('summary')).toBeNull();
    expect(screen.getByTestId('main-button')).toHaveTextContent('RESUMEN');
    await fireEvent.press(screen.getByTestId('main-button'));
    expect(screen.getByTestId('summary')).toBeTruthy();
  });

  it('en el DESCANSO el botón de fin es SUSPENDER y el resumen lo marca como suspendido', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('main-button'));
    await advance(5_000);
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.getByTestId('end-button')).toHaveTextContent('FINALIZAR');
    await fireEvent(screen.getByTestId('halftime-button'), 'longPress');
    expect(screen.getByTestId('period')).toHaveTextContent('DESCANSO');

    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.getByTestId('end-button')).toHaveTextContent('SUSPENDER');
    await fireEvent(screen.getByTestId('end-button'), 'longPress');
    expect(screen.getByTestId('period')).toHaveTextContent('FINAL');
    expect(screen.getByTestId('summary')).toHaveTextContent(/suspendido/);
  });

  it('nada recorta la ficha del banquillo mientras se arrastra: ningún ancestro hasta el banquillo tiene overflow hidden', async () => {
    // La ficha se desplaza por `transform` sin cambiar de padre: un `overflow:
    // hidden` en la fila la haría desaparecer al subir hacia el campo.
    const screen = await renderScreen();
    const clipping: string[] = [];
    let node = screen.getByTestId('token-hugo').parent;
    let reachedBench = false;
    while (node) {
      if (node.props.testID === 'bench') {
        reachedBench = true;
        break;
      }
      const style = StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>);
      if (style?.overflow === 'hidden') clipping.push(String(node.type));
      node = node.parent;
    }
    expect(reachedBench).toBe(true);
    expect(clipping).toEqual([]);
  });

  it('la ficha anuncia dónde está y el campo y el banquillo son botones con pista', async () => {
    const screen = await renderScreen();
    expect(screen.getByTestId('token-lucas').props.accessibilityLabel).toBe('Lucas, dorsal 7, en el campo, 00:00 jugados');
    expect(screen.getByTestId('token-hugo').props.accessibilityLabel).toBe('Hugo, dorsal 5, en el banquillo, 00:00 jugados');
    for (const zone of ['pitch', 'bench'] as const) {
      expect(screen.getByTestId(zone).props.accessibilityRole).toBe('button');
      expect(screen.getByTestId(zone).props.accessibilityHint).toMatch(/seleccionado/);
    }
  });

  it('sin onExit no hay salida: ni SALIR en el menú ⋯ ni VOLVER AL INICIO en el resumen', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('exit-button')).toBeNull();
    expect(screen.getByTestId('formations')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('menu-button'));

    await fireEvent.press(screen.getByTestId('main-button'));
    await advance(5_000);
    await fireEvent.press(screen.getByTestId('menu-button'));
    await fireEvent(screen.getByTestId('end-button'), 'longPress');
    expect(screen.getByTestId('summary')).toBeTruthy();
    expect(screen.queryByTestId('exit-match')).toBeNull();
    await fireEvent.press(screen.getByTestId('summary-close'));
    // En FINAL sin salida el menú sigue sin acciones.
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('exit-button')).toBeNull();
    expect(screen.getByText('Sin acciones en este estado')).toBeTruthy();
  });

  it('con onExit: SALIR (mantener pulsado, ≥ 56 dp) solo en READY y FINAL, nunca en marcha ni en pausa; el resumen ofrece VOLVER AL INICIO', async () => {
    const onExit = jest.fn();
    const screen = await renderScreen(onExit);

    await fireEvent.press(screen.getByTestId('menu-button'));
    const exit = screen.getByTestId('exit-button');
    expect(exit).toHaveTextContent('SALIR');
    expect(exit.props.accessibilityLabel).toBe('SALIR, mantén pulsado');
    expect(flat(exit.props.style).minHeight).toBeGreaterThanOrEqual(56);
    // Un toque corto solo enseña la pista: salir sin querer no puede pasar.
    await fireEvent.press(exit);
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByTestId('hold-hint')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('menu-button'));

    await fireEvent.press(screen.getByTestId('main-button')); // INICIAR → en marcha
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('exit-button')).toBeNull();
    await fireEvent.press(screen.getByTestId('menu-button'));

    await fireEvent.press(screen.getByTestId('main-button')); // PAUSA
    await fireEvent.press(screen.getByTestId('menu-button'));
    expect(screen.queryByTestId('exit-button')).toBeNull();
    await fireEvent(screen.getByTestId('end-button'), 'longPress'); // FINALIZAR → resumen

    const back = screen.getByTestId('exit-match');
    expect(back).toHaveTextContent('VOLVER AL INICIO');
    expect(flat(back.props.style).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(back);
    expect(onExit).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('summary-close'));
    await fireEvent.press(screen.getByTestId('menu-button'));
    await fireEvent(screen.getByTestId('exit-button'), 'longPress');
    expect(onExit).toHaveBeenCalledTimes(2);
  });
});
