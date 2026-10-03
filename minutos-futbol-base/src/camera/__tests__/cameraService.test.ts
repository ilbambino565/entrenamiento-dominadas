import { createEventBus, type EventBus } from '../../events/bus';
import { type AppBusEventMap } from '../automation';
import { createCameraService, type CameraBusEventMap } from '../cameraService';
import { INITIAL_CAMERA_STATUS, createCameraStore } from '../cameraStore';
import { createDummyCameraController } from '../dummyCameraController';
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from '../types';

type Emitted = {
  [K in keyof CameraBusEventMap]: { topic: K; payload: CameraBusEventMap[K] };
}[keyof CameraBusEventMap];

/** Bus falso: solo graba lo que se publica. El servicio nunca se suscribe al bus. */
function recordingBus() {
  const events: Emitted[] = [];
  const bus: EventBus<CameraBusEventMap> = {
    emit: (topic, payload) => {
      events.push({ topic, payload } as Emitted);
    },
    on: () => () => {},
    once: () => () => {},
    off: () => {},
    listenerCount: () => 0,
    clear: () => {},
  };
  return { bus, events, topics: () => events.map((e) => e.topic) };
}

const ZONES_SETTINGS: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  deviceType: 'dummy',
  zones: {
    ...DEFAULT_CAMERA_SETTINGS.zones,
    LEFT: { pan: -30, tilt: 0 },
    CENTER: { pan: 0, tilt: 0, zoom: 0.2 },
  },
  smoothTransitionMs: 800,
};

interface SetupOptions {
  /** null = configuración por defecto (modo external). */
  settings?: Partial<CameraSettings> | null;
  attach?: boolean;
}

function setup({ settings = ZONES_SETTINGS, attach = true }: SetupOptions = {}) {
  let t = 1_000;
  const now = () => t;
  const advance = (ms: number) => (t += ms);
  let n = 0;
  const newId = () => `rec-${++n}`;
  const { bus, events, topics } = recordingBus();
  const store = createCameraStore(settings ?? undefined);
  const dummy = createDummyCameraController({ now });
  const service = createCameraService({ bus, store, now, newId, ...(attach ? { controller: dummy } : {}) });
  return { service, store, dummy, events, topics, now, advance };
}

const ALL_OPERATIONS = [
  'connect',
  'disconnect',
  'startRecording',
  'pauseRecording',
  'resumeRecording',
  'stopRecording',
  'recenter',
  'panLeft',
  'panRight',
  'stopPan',
  'zoomIn',
  'zoomOut',
] as const;

describe('createCameraService', () => {
  describe('modo external (MVP) y sin controlador', () => {
    it('con la configuración por defecto toda operación devuelve false sin tocar el hardware', async () => {
      const { service, dummy, events, store } = setup({ settings: null });
      expect(store.getState().controllerAttached).toBe(true);
      expect(store.getState().available).toBe(false);

      for (const operation of ALL_OPERATIONS) await expect(service[operation]()).resolves.toBe(false);
      await expect(service.goToZone('LEFT')).resolves.toBe(false);
      await expect(service.setZoom(0.5)).resolves.toBe(false);

      expect(dummy.getHistory()).toEqual([]);
      expect(events).toEqual([]);
      expect(service.getStatus()).toMatchObject({ connection: 'disconnected', error: null });
    });

    it('en modo zones pero sin controlador también devuelve false', async () => {
      const { service, events, store } = setup({ attach: false });
      expect(store.getState().controllerAttached).toBe(false);
      for (const operation of ALL_OPERATIONS) await expect(service[operation]()).resolves.toBe(false);
      await expect(service.goToZone('LEFT')).resolves.toBe(false);
      expect(events).toEqual([]);
    });

    it('configure(null) vuelve a los valores por defecto y desactiva el control', async () => {
      const { service, store } = setup();
      expect(store.getState().available).toBe(true);
      service.configure(null);
      expect(service.getSettings()).toEqual(DEFAULT_CAMERA_SETTINGS);
      expect(store.getState().available).toBe(false);
      await expect(service.connect()).resolves.toBe(false);
    });

    it('configure normaliza y sustituye (no mezcla) la configuración', () => {
      const { service } = setup();
      service.configure({ enabled: true, mode: 'auto', smoothTransitionMs: -1 });
      expect(service.getSettings()).toEqual({ ...DEFAULT_CAMERA_SETTINGS, enabled: true, mode: 'auto' });
    });
  });

  describe('conexión', () => {
    it('connect refleja connecting y connected en el store y publica camera.connection.changed', async () => {
      const { service, store, events, now } = setup();
      await expect(service.connect()).resolves.toBe(true);

      expect(store.getState().status).toMatchObject({ connection: 'connected', updatedAt: now() });
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        topic: 'camera.connection.changed',
        payload: { status: { connection: 'connecting' }, timestamp: now() },
      });
      expect(events[1]).toMatchObject({
        topic: 'camera.connection.changed',
        payload: { status: { connection: 'connected' }, timestamp: now() },
      });
    });

    it('connect ya conectado → false, camera.error y status.error con el código', async () => {
      const { service, events, topics } = setup();
      await service.connect();
      await expect(service.connect()).resolves.toBe(false);
      expect(topics().at(-1)).toBe('camera.error');
      expect(events.at(-1)?.payload).toMatchObject({ message: expect.stringContaining('ALREADY_CONNECTED') });
      expect(service.getStatus().error).toContain('ALREADY_CONNECTED');
    });

    it('operar sin conectar → false con camera.error NOT_CONNECTED, sin lanzar', async () => {
      const { service, events } = setup();
      await expect(service.startRecording()).resolves.toBe(false);
      expect(events).toEqual([
        {
          topic: 'camera.error',
          payload: { message: expect.stringContaining('NOT_CONNECTED'), timestamp: 1_000 },
        },
      ]);
      expect(service.getStatus().error).toContain('NOT_CONNECTED');
    });

    it('disconnect publica connection.changed y devuelve true', async () => {
      const { service, events } = setup();
      await service.connect();
      events.length = 0;
      await expect(service.disconnect()).resolves.toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        topic: 'camera.connection.changed',
        payload: { status: { connection: 'disconnected' } },
      });
    });

    it('una operación correcta limpia el error anterior', async () => {
      const { service } = setup();
      await service.startRecording();
      expect(service.getStatus().error).not.toBeNull();
      await service.connect();
      expect(service.getStatus().error).toBeNull();
    });
  });

  describe('grabación', () => {
    it('start/pause/resume/stop publican los eventos con un recordingId estable', async () => {
      const { service, store, events, advance } = setup();
      await service.connect();
      events.length = 0;

      advance(10);
      await expect(service.startRecording()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ recording: 'recording', recordingId: 'rec-1' });

      advance(10);
      await expect(service.pauseRecording()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ recording: 'paused', recordingId: 'rec-1' });

      advance(10);
      await expect(service.resumeRecording()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ recording: 'recording', recordingId: 'rec-1' });

      advance(10);
      await expect(service.stopRecording()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ recording: 'idle', recordingId: null });

      expect(events).toEqual([
        {
          topic: 'camera.record.started',
          payload: { recordingId: 'rec-1', deviceType: 'dummy', timestamp: 1_010 },
        },
        { topic: 'camera.record.paused', payload: { recordingId: 'rec-1', timestamp: 1_020 } },
        { topic: 'camera.record.resumed', payload: { recordingId: 'rec-1', timestamp: 1_030 } },
        { topic: 'camera.record.stopped', payload: { recordingId: 'rec-1', timestamp: 1_040 } },
      ]);

      // Una segunda grabación recibe un id nuevo.
      await service.startRecording();
      expect(store.getState().status.recordingId).toBe('rec-2');
    });

    it('pause/resume/stop sin grabación iniciada por el servicio → false sin tocar el hardware', async () => {
      const { service, dummy, events } = setup();
      await service.connect();
      events.length = 0;
      await expect(service.pauseRecording()).resolves.toBe(false);
      await expect(service.resumeRecording()).resolves.toBe(false);
      await expect(service.stopRecording()).resolves.toBe(false);
      expect(dummy.getHistory()).toEqual(['connect']);
      expect(events).toEqual([]);
    });

    it('error del controlador (ya grabando) → false, camera.error y status.error', async () => {
      const { service, events, topics } = setup();
      await service.connect();
      await service.startRecording();
      events.length = 0;

      await expect(service.startRecording()).resolves.toBe(false);
      expect(topics()).toEqual(['camera.error']);
      expect(events[0]?.payload).toMatchObject({ message: expect.stringContaining('ALREADY_RECORDING') });
      expect(service.getStatus()).toMatchObject({
        recording: 'recording',
        recordingId: 'rec-1',
        error: expect.stringContaining('ALREADY_RECORDING'),
      });
    });

    it('desconexión inesperada durante la grabación → idle en el store y camera.record.stopped', async () => {
      const { service, store, dummy, events, advance } = setup();
      await service.connect();
      await service.startRecording();
      events.length = 0;

      advance(50);
      dummy.simulateDisconnect();

      expect(store.getState().status).toMatchObject({
        connection: 'disconnected',
        recording: 'idle',
        recordingId: null,
      });
      expect(events).toEqual([
        {
          topic: 'camera.connection.changed',
          payload: { status: expect.objectContaining({ connection: 'disconnected', recording: 'idle' }), timestamp: 1_050 },
        },
        { topic: 'camera.record.stopped', payload: { recordingId: 'rec-1', timestamp: 1_050 } },
      ]);

      // Y después se puede empezar otra sin arrastrar nada.
      await service.connect();
      await expect(service.startRecording()).resolves.toBe(true);
      expect(store.getState().status.recordingId).toBe('rec-2');
    });

    it('error del dispositivo durante la grabación → camera.error, status.error y record.stopped', async () => {
      const { service, store, dummy, events, topics } = setup();
      await service.connect();
      await service.startRecording();
      events.length = 0;

      dummy.simulateError('Batería agotada');

      expect(store.getState().status).toMatchObject({
        connection: 'error',
        recording: 'idle',
        recordingId: null,
        error: 'Batería agotada',
      });
      expect(topics()).toEqual(['camera.connection.changed', 'camera.error', 'camera.record.stopped']);
      expect(events[1]?.payload).toMatchObject({ message: 'Batería agotada' });
      expect(events[2]?.payload).toMatchObject({ recordingId: 'rec-1' });
    });

    it('disconnect pedido por el servicio con grabación en curso también cierra la grabación', async () => {
      const { service, store, events, topics } = setup();
      await service.connect();
      await service.startRecording();
      events.length = 0;

      await expect(service.disconnect()).resolves.toBe(true);
      expect(topics()).toEqual(['camera.connection.changed', 'camera.record.stopped']);
      expect(store.getState().status).toMatchObject({ recording: 'idle', recordingId: null });
    });
  });

  describe('zonas y movimiento', () => {
    it('goToZone usa la posición calibrada y la transición configurada, y publica zone.changed', async () => {
      const { service, store, dummy, events, advance } = setup();
      await service.connect();
      events.length = 0;

      advance(5);
      await expect(service.goToZone('LEFT')).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({
        zone: 'LEFT',
        position: { pan: -30, tilt: 0, zoom: 0 },
      });
      expect(dummy.getHistory().at(-1)).toBe('goToPosition(-30,0,800)');

      advance(5);
      await expect(service.goToZone('CENTER')).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ zone: 'CENTER', zoom: 0.2 });

      expect(events).toEqual([
        { topic: 'camera.zone.changed', payload: { zone: 'LEFT', previousZone: null, timestamp: 1_005 } },
        { topic: 'camera.zone.changed', payload: { zone: 'CENTER', previousZone: 'LEFT', timestamp: 1_010 } },
      ]);
    });

    it('zona no calibrada → false, camera.error ZONE_NOT_CALIBRATED y sin tocar el hardware', async () => {
      const { service, dummy, events, store } = setup();
      await service.connect();
      events.length = 0;

      await expect(service.goToZone('RIGHT')).resolves.toBe(false);
      expect(events).toEqual([
        {
          topic: 'camera.error',
          payload: { message: expect.stringContaining('ZONE_NOT_CALIBRATED'), timestamp: 1_000 },
        },
      ]);
      expect(store.getState().status.error).toContain('RIGHT');
      expect(store.getState().status.zone).toBeNull();
      expect(dummy.getHistory()).toEqual(['connect']);
    });

    it('la zona activa se conserva en las notificaciones del controlador y se anula al mover', async () => {
      const { service, store } = setup();
      await service.connect();
      await service.goToZone('LEFT');

      await service.startRecording();
      await service.stopPan();
      expect(store.getState().status.zone).toBe('LEFT');

      await expect(service.panLeft()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ zone: null, panning: 'left' });

      await service.goToZone('CENTER');
      await expect(service.recenter()).resolves.toBe(true);
      expect(store.getState().status).toMatchObject({ zone: null, position: { pan: 0, tilt: 0 } });
    });

    it('panRight/stopPan se reflejan en el store', async () => {
      const { service, store } = setup();
      await service.connect();
      await expect(service.panRight()).resolves.toBe(true);
      expect(store.getState().status.panning).toBe('right');
      await expect(service.stopPan()).resolves.toBe(true);
      expect(store.getState().status.panning).toBeNull();
    });
  });

  describe('zoom', () => {
    it('con zoomEnabled false → false sin error y sin tocar el hardware', async () => {
      const { service, dummy, events } = setup();
      await service.connect();
      events.length = 0;
      await expect(service.zoomIn()).resolves.toBe(false);
      await expect(service.zoomOut()).resolves.toBe(false);
      await expect(service.setZoom(0.5)).resolves.toBe(false);
      expect(events).toEqual([]);
      expect(dummy.getHistory()).toEqual(['connect']);
      expect(service.getStatus().error).toBeNull();
    });

    it('con zoomEnabled true delega en el controlador', async () => {
      const { service, store } = setup({ settings: { ...ZONES_SETTINGS, zoomEnabled: true } });
      await service.connect();
      await expect(service.zoomIn()).resolves.toBe(true);
      expect(store.getState().status.zoom).toBe(0.1);
      await expect(service.setZoom(0.7)).resolves.toBe(true);
      expect(store.getState().status.zoom).toBe(0.7);
      await expect(service.zoomOut()).resolves.toBe(true);
      expect(store.getState().status.zoom).toBe(0.6);
      await expect(service.setZoom(Number.NaN)).resolves.toBe(false);
      expect(service.getStatus().error).toContain('UNSUPPORTED');
    });
  });

  describe('controlador', () => {
    it('attachController refleja el estado actual del controlador y marca attached', () => {
      const { service, store } = setup({ attach: false });
      const dummy = createDummyCameraController({ initialPosition: { pan: 3, tilt: 4 } });
      service.attachController(dummy);
      expect(store.getState()).toMatchObject({
        controllerAttached: true,
        available: true,
        status: { position: { pan: 3, tilt: 4, zoom: 0 } },
      });
    });

    it('detachController desconecta, cierra la grabación y deja el estado inicial', async () => {
      const { service, store, dummy, topics, now } = setup();
      await service.connect();
      await service.startRecording();

      await service.detachController();
      expect(dummy.getHistory().at(-1)).toBe('disconnect');
      expect(dummy.getStatus().connection).toBe('disconnected');
      expect(store.getState()).toMatchObject({ controllerAttached: false, available: false });
      expect(store.getState().status).toEqual({ ...INITIAL_CAMERA_STATUS, updatedAt: now() });
      expect(topics().slice(-2)).toEqual(['camera.connection.changed', 'camera.record.stopped']);

      // El controlador suelto ya no influye en el store.
      dummy.simulateError('ruido');
      expect(store.getState().status.error).toBeNull();
      await expect(service.connect()).resolves.toBe(false);
    });

    it('detachController sin controlador o sin conexión no publica nada', async () => {
      const { service, events } = setup();
      await service.detachController();
      await service.detachController();
      expect(events).toEqual([]);
    });

    it('attachController sustituye al anterior sin desconectarlo', async () => {
      const { service, store, dummy } = setup();
      await service.connect();
      const other = createDummyCameraController();
      service.attachController(other);
      expect(store.getState().status.connection).toBe('disconnected');
      expect(dummy.getStatus().connection).toBe('connected');
      await dummy.panLeft();
      expect(store.getState().status.panning).toBeNull();
    });

    it('dispose suelta el controlador y deja el servicio inerte', async () => {
      const { service, store, dummy } = setup();
      await service.connect();
      await service.dispose();
      expect(dummy.getStatus().connection).toBe('disconnected');
      expect(store.getState().controllerAttached).toBe(false);

      service.attachController(createDummyCameraController());
      expect(store.getState().controllerAttached).toBe(false);
      await expect(service.connect()).resolves.toBe(false);
    });
  });

  describe('estado', () => {
    it('getStatus devuelve una copia', async () => {
      const { service } = setup();
      await service.connect();
      await service.goToZone('LEFT');
      const status = service.getStatus();
      status.connection = 'error';
      status.position!.pan = 99;
      expect(service.getStatus()).toMatchObject({ connection: 'connected', position: { pan: -30 } });
    });

    it('acepta el bus de la app (AppEventMap) y los suscriptores reciben los eventos', async () => {
      const appBus = createEventBus<AppBusEventMap>();
      const store = createCameraStore(ZONES_SETTINGS);
      const service = createCameraService({
        bus: appBus,
        store,
        controller: createDummyCameraController(),
        now: () => 42,
      });
      const seen = jest.fn();
      appBus.on('camera.connection.changed', seen);
      await service.connect();
      expect(seen).toHaveBeenCalledTimes(2);
      expect(seen.mock.calls[1]?.[0]).toMatchObject({ status: { connection: 'connected' }, timestamp: 42 });
    });

    it('por defecto genera recordingId UUIDv7 y usa Date.now()', async () => {
      const { bus } = recordingBus();
      const store = createCameraStore(ZONES_SETTINGS);
      const service = createCameraService({ bus, store, controller: createDummyCameraController() });
      const before = Date.now();
      await service.connect();
      await service.startRecording();
      const status = service.getStatus();
      expect(status.recordingId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(status.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });
});
