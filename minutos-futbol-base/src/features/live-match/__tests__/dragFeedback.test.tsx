import { act, render, type RenderResult } from '@testing-library/react-native';
import { useEffect, useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useMatchState } from '../../../state';
import { LIGHT } from '../../../ui/theme';
import { Bench } from '../Bench';
import { createDemoSession, prepareDemo, type DemoSession } from '../createDemoSession';
import { DEMO_PLAYER_MAP } from '../demoTeam';
import { Pitch, type TokenView } from '../Pitch';
import { FIELD_FULL_MESSAGE, useDragAndDrop, type DragController } from '../useDragAndDrop';

/**
 * Aviso ANTES de soltar (docs/04 §4.2). El gesto en sí no se puede simular
 * (gesture-handler y Reanimated van mockeados), así que se llama al
 * controlador como lo haría el worklet y se mira lo que pintan campo y banquillo.
 */
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const PITCH = { x: 0, y: 0, width: 340, height: 500 };
const BENCH = { x: 0, y: 520, width: 340, height: 130 };
/** Zona libre del campo: a más de 38 px de cualquier ficha de la demo. */
const FREE = { x: 340 * 0.8, y: 500 * 0.8 };

function Harness({ demo, notify, onController }: { demo: DemoSession; notify: (m: string) => void; onController: (c: DragController) => void }) {
  const state = useMatchState(demo.session.engine);
  const { controller, drag } = useDragAndDrop(demo.session.engine, notify);
  useEffect(() => {
    onController(controller);
  }, [controller, onController]);
  const views = useMemo(() => {
    const out: Record<string, TokenView> = {};
    for (const id of Object.keys(DEMO_PLAYER_MAP)) out[id] = { playedMs: 0, tone: 'even' };
    return out;
  }, []);
  return (
    <>
      <Pitch state={state} players={demo.players} views={views} controller={controller} drag={drag} />
      <Bench state={state} players={demo.players} views={views} controller={controller} drag={drag} now={0} />
    </>
  );
}

const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);

async function setup(): Promise<{ screen: RenderResult; controller: DragController; demo: DemoSession; notify: jest.Mock }> {
  const demo = createDemoSession();
  await prepareDemo(demo.session);
  const notify = jest.fn();
  let controller: DragController | null = null;
  const screen = await render(
    <Harness
      demo={demo}
      notify={notify}
      onController={(c) => {
        controller = c;
      }}
    />,
  );
  if (!controller) throw new Error('el controlador no llegó');
  const c: DragController = controller;
  await act(async () => {
    c.registerPitch(PITCH);
    c.registerBench(BENCH);
  });
  return { screen, controller: c, demo, notify };
}

describe('aviso previo al soltar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('campo lleno: el campo se enmarca en rojo, sin tic de destino, y soltar avisa; con hueco se enmarca en azul con tic', async () => {
    const { screen, controller, demo, notify } = await setup();

    await act(async () => controller.beginDrag('hugo', 'BENCH'));
    await act(async () => controller.updateDrag(FREE));
    expect(flat(screen.getByTestId('pitch-frame').props.style)).toMatchObject({ borderColor: LIGHT.colors.danger, borderWidth: 4 });
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await act(async () => {
      controller.endDrag(FREE);
      controller.finalizeDrag();
    });
    expect(notify).toHaveBeenCalledWith(FIELD_FULL_MESSAGE);
    expect(screen.queryByTestId('pitch-frame')).toBeNull();

    // Con un hueco (Pablo sale) el mismo punto es una entrada válida.
    await act(async () => {
      await demo.session.engine.leavePlayer('pablo');
    });
    await act(async () => controller.beginDrag('hugo', 'BENCH'));
    await act(async () => controller.updateDrag(FREE));
    expect(flat(screen.getByTestId('pitch-frame').props.style)).toMatchObject({ borderColor: LIGHT.colors.accent });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      controller.endDrag(FREE);
      controller.finalizeDrag();
    });
    expect(demo.session.engine.getState().players.hugo?.location).toBe('FIELD');
  });

  it('sobre el banquillo con un titular: tinte + marco de 4 dp en accent; al soltar sale', async () => {
    const { screen, controller, demo } = await setup();
    const inBench = { x: 100, y: BENCH.y + 60 };
    await act(async () => controller.beginDrag('lucas', 'FIELD'));
    await act(async () => controller.updateDrag(inBench));
    expect(flat(screen.getByTestId('bench').props.style)).toMatchObject({ backgroundColor: LIGHT.colors.benchHighlight });
    expect(flat(screen.getByTestId('bench-frame').props.style)).toMatchObject({ borderColor: LIGHT.colors.accent, borderWidth: 4 });
    await act(async () => {
      controller.endDrag(inBench);
      controller.finalizeDrag();
    });
    expect(screen.queryByTestId('bench-frame')).toBeNull();
    expect(demo.session.engine.getState().players.lucas?.location).toBe('BENCH');
  });

  it('recolocar un titular a 20 px de su sitio es un movimiento real (la propia ficha no es imán)', async () => {
    const { controller, demo } = await setup();
    const before = demo.session.engine.getState().players.lucas?.position;
    // Centro de Lucas en el campo de 340×500: (0,2·340, 0,45·500) = (68, 225).
    const point = { x: 68 + 20, y: 225 };
    await act(async () => controller.beginDrag('lucas', 'FIELD'));
    await act(async () => {
      controller.endDrag(point);
      controller.finalizeDrag();
    });
    const after = demo.session.engine.getState().players.lucas?.position;
    expect(after).not.toEqual(before);
    expect(after?.x).toBeCloseTo(88 / 340, 5);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });
});
