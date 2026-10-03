import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { INITIAL_CAMERA_STATUS, createCameraService, createCameraStore, createDummyCameraController, type AppBusEventMap, type CameraStore } from '../../../camera';
import { createEventBus } from '../../../events/bus';
import { CameraPanel } from '../CameraPanel';
import { selectBadgeLabel } from '../CameraStatusBadge';
import { useCameraState } from '../useCameraStore';

/**
 * Revisión de compatibilidad React 19 + zustand 5 (`useSyncExternalStore`).
 *
 * - Un selector que devuelve un primitivo no provoca repintados cuando cambia
 *   otra parte del estado: la pantalla del partido no debe repintarse porque
 *   la cámara cambie de zoom. Si alguien cambiara el selector por uno que
 *   devuelve un objeto nuevo en cada llamada, React 19 lanzaría un bucle de
 *   "getSnapshot should be cached" y este test lo delataría.
 * - Todos los controles del panel son botones accesibles (`accessibilityRole`).
 */
function Probe({ store, onRender }: { store: CameraStore; onRender: () => void }) {
  onRender();
  const label = useCameraState(store, selectBadgeLabel);
  return <Text>{label}</Text>;
}

describe('review-compat-expo: useCameraState con selector a primitivo', () => {
  it('no repinta con cambios irrelevantes (zoom, updatedAt) y sí cuando cambia la etiqueta', async () => {
    const store = createCameraStore();
    const onRender = jest.fn();
    const screen = await render(<Probe store={store} onRender={onRender} />);
    expect(screen.getByText('EXTERNAL')).toBeTruthy();
    const initialRenders = onRender.mock.calls.length;

    await act(() => store.setStatus({ ...INITIAL_CAMERA_STATUS, zoom: 0.5, updatedAt: 1 }));
    await act(() => store.setStatus({ ...INITIAL_CAMERA_STATUS, zoom: 0.9, updatedAt: 2, panning: 'left' }));
    expect(onRender).toHaveBeenCalledTimes(initialRenders);

    await act(() => store.setSettings({ enabled: true, mode: 'zones' }));
    expect(screen.getByText('ON')).toBeTruthy();
    expect(onRender.mock.calls.length).toBeGreaterThan(initialRenders);
  });
});

describe('review-compat-expo: CameraPanel accesible', () => {
  it('todos los controles son Pressable con accessibilityRole="button" (9 con zoom habilitado)', async () => {
    const now = () => 1_000;
    const bus = createEventBus<AppBusEventMap>();
    const store = createCameraStore({ enabled: true, mode: 'zones', deviceType: 'dummy', zoomEnabled: true });
    const service = createCameraService({ bus, store, controller: createDummyCameraController({ now }), now });
    const screen = await render(<CameraPanel store={store} service={service} visible />);
    // 3 zonas + REC/PAUSA/STOP + ZOOM −/ZOOM +/RECENTER
    expect(screen.getAllByRole('button')).toHaveLength(9);
  });
});
