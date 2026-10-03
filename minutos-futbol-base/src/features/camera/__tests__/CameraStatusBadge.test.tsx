import { act, render } from '@testing-library/react-native';
import { INITIAL_CAMERA_STATUS, createCameraStore } from '../../../camera';
import { CameraStatusBadge, selectBadgeLabel } from '../CameraStatusBadge';

describe('CameraStatusBadge', () => {
  it('con la configuración por defecto (el MVP) muestra CAMERA ● EXTERNAL', async () => {
    const store = createCameraStore();
    const screen = await render(<CameraStatusBadge store={store} visible />);
    expect(screen.getByText('CAMERA ● EXTERNAL')).toBeTruthy();
  });

  it('oculto por defecto (feature flag) o con visible=false no renderiza nada', async () => {
    const store = createCameraStore();
    expect((await render(<CameraStatusBadge store={store} />)).toJSON()).toBeNull();
    expect((await render(<CameraStatusBadge store={store} visible={false} />)).toJSON()).toBeNull();
  });

  it('refleja la grabación en modo zones y se actualiza al cambiar el store', async () => {
    const store = createCameraStore({ enabled: true, mode: 'zones' });
    const screen = await render(<CameraStatusBadge store={store} visible />);
    expect(screen.getByText('CAMERA ● ON')).toBeTruthy();

    await act(() => store.setStatus({ ...INITIAL_CAMERA_STATUS, connection: 'connected', recording: 'recording' }));
    expect(screen.getByText('CAMERA ● REC')).toBeTruthy();

    await act(() => store.setStatus({ ...INITIAL_CAMERA_STATUS, connection: 'connected', recording: 'paused' }));
    expect(screen.getByText('CAMERA ● PAUSED')).toBeTruthy();
  });

  it('selectBadgeLabel: el modo external manda; deshabilitada es OFF', () => {
    const external = createCameraStore({ enabled: true, mode: 'external' }).getState();
    expect(selectBadgeLabel({ ...external, status: { ...external.status, recording: 'recording' } })).toBe('EXTERNAL');
    const off = createCameraStore({ enabled: false, mode: 'zones' }).getState();
    expect(selectBadgeLabel(off)).toBe('OFF');
  });
});
