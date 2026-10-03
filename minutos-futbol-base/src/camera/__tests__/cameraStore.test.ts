import { createCameraStore } from '../cameraStore';
import { INITIAL_CAMERA_STATUS } from '../status';
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings, type CameraStatus } from '../types';

describe('INITIAL_CAMERA_STATUS', () => {
  it('es el estado "nada conectado" y está congelado', () => {
    expect(INITIAL_CAMERA_STATUS).toEqual<CameraStatus>({
      connection: 'disconnected',
      recording: 'idle',
      recordingId: null,
      zone: null,
      position: null,
      zoom: 0,
      panning: null,
      error: null,
      updatedAt: 0,
    });
    expect(Object.isFrozen(INITIAL_CAMERA_STATUS)).toBe(true);
  });
});

describe('createCameraStore', () => {
  it('sin argumentos arranca con la configuración por defecto y nada disponible', () => {
    const store = createCameraStore();
    expect(store.getState()).toEqual({
      settings: DEFAULT_CAMERA_SETTINGS,
      status: INITIAL_CAMERA_STATUS,
      controllerAttached: false,
      capabilities: null,
      available: false,
    });
    // El estado no comparte la instancia congelada: el servicio lo sobreescribe sin miedo.
    expect(store.getState().status).not.toBe(INITIAL_CAMERA_STATUS);
  });

  it('normaliza la configuración inicial', () => {
    const store = createCameraStore({
      enabled: true,
      mode: 'bogus' as CameraSettings['mode'],
      smoothTransitionMs: -5,
    });
    expect(store.getState().settings).toEqual({ ...DEFAULT_CAMERA_SETTINGS, enabled: true });
  });

  it('available = control disponible && controlador adjunto', () => {
    const store = createCameraStore({ enabled: true, mode: 'zones' });
    expect(store.getState().available).toBe(false);

    store.setControllerAttached(true);
    expect(store.getState().available).toBe(true);

    store.setSettings({ mode: 'external' });
    expect(store.getState().available).toBe(false);

    store.setSettings({ mode: 'zones' });
    expect(store.getState().available).toBe(true);

    store.setSettings({ enabled: false });
    expect(store.getState().available).toBe(false);

    store.setSettings({ enabled: true });
    store.setControllerAttached(false);
    expect(store.getState().available).toBe(false);
  });

  it('setSettings mezcla el parcial con lo anterior y normaliza', () => {
    const store = createCameraStore({ enabled: true, mode: 'zones', smoothTransitionMs: 700 });
    store.setSettings({ zones: { ...DEFAULT_CAMERA_SETTINGS.zones, LEFT: { pan: -30, tilt: 0 } } });
    store.setSettings({ smoothTransitionMs: Number.NaN });
    expect(store.getState().settings).toEqual({
      ...DEFAULT_CAMERA_SETTINGS,
      enabled: true,
      mode: 'zones',
      smoothTransitionMs: 1500,
      zones: { ...DEFAULT_CAMERA_SETTINGS.zones, LEFT: { pan: -30, tilt: 0 } },
    });
  });

  it('setStatus guarda una copia', () => {
    const store = createCameraStore();
    const status: CameraStatus = {
      ...INITIAL_CAMERA_STATUS,
      connection: 'connected',
      position: { pan: 1, tilt: 2 },
      updatedAt: 10,
    };
    store.setStatus(status);
    status.connection = 'error';
    status.position!.pan = 99;
    expect(store.getState().status).toMatchObject({
      connection: 'connected',
      position: { pan: 1, tilt: 2 },
      updatedAt: 10,
    });
  });

  it('reset vuelve a la configuración inicial, al estado inicial y sin controlador', () => {
    const store = createCameraStore({ enabled: true, mode: 'zones' });
    store.setControllerAttached(true);
    store.setSettings({ mode: 'auto', zoomEnabled: true });
    store.setStatus({ ...INITIAL_CAMERA_STATUS, connection: 'connected', updatedAt: 5 });

    store.reset();
    expect(store.getState()).toEqual({
      settings: { ...DEFAULT_CAMERA_SETTINGS, enabled: true, mode: 'zones' },
      status: INITIAL_CAMERA_STATUS,
      controllerAttached: false,
      capabilities: null,
      available: false,
    });
  });

  it('subscribe avisa de cada cambio (API vanilla de zustand)', () => {
    const store = createCameraStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    store.setControllerAttached(true);
    store.setStatus({ ...INITIAL_CAMERA_STATUS, updatedAt: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
