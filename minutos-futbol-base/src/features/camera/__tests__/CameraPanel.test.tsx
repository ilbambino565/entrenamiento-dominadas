import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  createCameraService,
  createCameraStore,
  createDummyCameraController,
  type AppBusEventMap,
  type CameraSettings,
} from '../../../camera';
import { createEventBus } from '../../../events/bus';
import { CameraPanel } from '../CameraPanel';

/**
 * RNTL 14 (React 19): `render` y `fireEvent` son asíncronos y las
 * actualizaciones del store fuera de un evento se envuelven en `act`.
 */
const ZONES_SETTINGS: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  deviceType: 'dummy',
  zones: { FAR_LEFT: null, LEFT: null, CENTER: { pan: 0, tilt: 0 }, RIGHT: null, FAR_RIGHT: null },
  zoomEnabled: true,
};

const BUTTONS = [
  'camera-zone-LEFT',
  'camera-zone-CENTER',
  'camera-zone-RIGHT',
  'camera-rec',
  'camera-pause',
  'camera-stop',
  'camera-recenter',
] as const;

function setup(settings: Partial<CameraSettings> | null = ZONES_SETTINGS) {
  const now = () => 1_000;
  const bus = createEventBus<AppBusEventMap>();
  const store = createCameraStore(settings ?? undefined);
  const dummy = createDummyCameraController({ now });
  const service = createCameraService({ bus, store, controller: dummy, now });
  return { store, service, dummy };
}

const isDisabled = (element: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  element.props.accessibilityState?.disabled === true;

describe('CameraPanel', () => {
  it('con visible=false (el valor por defecto del feature flag) no renderiza nada', async () => {
    const { store, service } = setup();
    expect((await render(<CameraPanel store={store} service={service} visible={false} />)).toJSON()).toBeNull();
    expect((await render(<CameraPanel store={store} service={service} />)).toJSON()).toBeNull();
  });

  it('en modo zones con el dummy conectado: REC llama al servicio y el indicador cambia', async () => {
    const { store, service } = setup();
    await service.connect();
    const startRecording = jest.spyOn(service, 'startRecording');
    const screen = await render(<CameraPanel store={store} service={service} visible />);

    expect(screen.getByText('Conectada')).toBeTruthy();
    expect(screen.getByText('Sin grabar')).toBeTruthy();
    expect(isDisabled(screen.getByTestId('camera-rec'))).toBe(false);
    expect(isDisabled(screen.getByTestId('camera-stop'))).toBe(true);

    await fireEvent.press(screen.getByTestId('camera-rec'));

    expect(startRecording).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Grabando')).toBeTruthy());
    expect(isDisabled(screen.getByTestId('camera-rec'))).toBe(true);
    expect(isDisabled(screen.getByTestId('camera-pause'))).toBe(false);
    expect(isDisabled(screen.getByTestId('camera-stop'))).toBe(false);

    await fireEvent.press(screen.getByTestId('camera-pause'));
    await waitFor(() => expect(screen.getByText('Grabación en pausa')).toBeTruthy());
    expect(screen.getByText('REANUDAR')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('camera-stop'));
    await waitFor(() => expect(screen.getByText('Sin grabar')).toBeTruthy());
  });

  it('una zona sin calibrar está deshabilitada y no hace nada; una calibrada llama a goToZone y queda activa', async () => {
    const { store, service, dummy } = setup();
    await service.connect();
    const goToZone = jest.spyOn(service, 'goToZone');
    const screen = await render(<CameraPanel store={store} service={service} visible />);

    const left = screen.getByTestId('camera-zone-LEFT');
    const center = screen.getByTestId('camera-zone-CENTER');
    expect(isDisabled(left)).toBe(true);
    expect(isDisabled(center)).toBe(false);
    expect(screen.getByText('IZQUIERDA')).toBeTruthy();
    expect(screen.getByText('DERECHA')).toBeTruthy();

    await fireEvent.press(left);
    expect(goToZone).not.toHaveBeenCalled();
    expect(dummy.getHistory()).toEqual(['connect']);

    await fireEvent.press(center);
    expect(goToZone).toHaveBeenCalledWith('CENTER');
    await waitFor(() => expect(screen.getByTestId('camera-zone-CENTER').props.accessibilityState.selected).toBe(true));
    expect(dummy.getHistory()).toEqual(['connect', 'goToPosition(0,0,1500)']);
  });

  it('zoom y recenter van al servicio; sin zoomEnabled los botones de zoom no existen', async () => {
    const { store, service } = setup();
    await service.connect();
    const zoomIn = jest.spyOn(service, 'zoomIn');
    const recenter = jest.spyOn(service, 'recenter');
    const screen = await render(<CameraPanel store={store} service={service} visible />);

    await fireEvent.press(screen.getByTestId('camera-zoom-in'));
    await fireEvent.press(screen.getByTestId('camera-recenter'));
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(recenter).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(store.getState().status.zoom).toBe(0.1));

    const { store: noZoom, service: noZoomService } = setup({ ...ZONES_SETTINGS, zoomEnabled: false });
    const other = await render(<CameraPanel store={noZoom} service={noZoomService} visible />);
    expect(other.queryByTestId('camera-zoom-in')).toBeNull();
    expect(other.queryByTestId('camera-zoom-out')).toBeNull();
    expect(other.getByTestId('camera-recenter')).toBeTruthy();
  });

  it('en modo external muestra "Control externo" y todos los botones están deshabilitados', async () => {
    const { store, service, dummy } = setup(null);
    const startRecording = jest.spyOn(service, 'startRecording');
    const screen = await render(<CameraPanel store={store} service={service} visible />);

    expect(screen.getByText('Control externo')).toBeTruthy();
    for (const testID of BUTTONS) expect(isDisabled(screen.getByTestId(testID))).toBe(true);

    await fireEvent.press(screen.getByTestId('camera-rec'));
    await fireEvent.press(screen.getByTestId('camera-zone-CENTER'));
    expect(startRecording).not.toHaveBeenCalled();
    expect(dummy.getHistory()).toEqual([]);
  });

  it('muestra el error del servicio y el estado de conexión', async () => {
    const { store, service, dummy } = setup();
    const screen = await render(<CameraPanel store={store} service={service} visible />);
    expect(screen.getByText('Desconectada')).toBeTruthy();

    // Grabar sin conectar: el servicio no lanza, deja el error en el estado.
    await fireEvent.press(screen.getByTestId('camera-rec'));
    await waitFor(() => expect(screen.getByTestId('camera-error')).toBeTruthy());
    expect(screen.getByText(/NOT_CONNECTED/)).toBeTruthy();

    await act(() => service.connect());
    expect(screen.getByText('Conectada')).toBeTruthy();
    await act(() => dummy.simulateError('sin señal'));
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('sin señal')).toBeTruthy();
  });
});
