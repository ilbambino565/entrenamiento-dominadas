import { createEventBus, type EventBus } from '../../events/bus';
import type { MatchBusEventMap } from '../../events/topics';
import { createCameraAutomation, type ClockBusEventMap } from '../automation';
import { createCameraService } from '../cameraService';
import { createCameraStore } from '../cameraStore';
import { createDummyCameraController } from '../dummyCameraController';
import type { CameraEventMap, CameraSettings } from '../types';

/**
 * Un gimbal (DJI RSC 2) mueve pero no graba; una cámara (Sony A6600) graba y
 * hace zoom pero no se mueve ni pausa. El servicio, el panel y la
 * automatización deben saberlo ANTES de mandar una orden, no al fallar.
 */

const ZONES: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  zoomEnabled: true,
  zones: { FAR_LEFT: null, LEFT: null, CENTER: { pan: 0, tilt: 0 }, RIGHT: null, FAR_RIGHT: null },
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('capacidades del dispositivo', () => {
  it('un gimbal sin grabación ni zoom: REC y ZOOM devuelven false sin publicar error; moverse funciona', async () => {
    const gimbal = createDummyCameraController({ now: () => 1, capabilities: { record: false, pause: false, zoom: false } });
    const bus = createEventBus<CameraEventMap>();
    const store = createCameraStore({ ...ZONES, deviceType: 'dji_rsc2' });
    const service = createCameraService({ bus, store, controller: gimbal, now: () => 1, newId: () => 'rec' });
    const errors: unknown[] = [];
    bus.on('camera.error', (e) => errors.push(e));

    await service.connect();
    expect(store.getState().capabilities).toEqual({ record: false, pause: false, pan: true, zoom: false });
    expect(service.getCapabilities()).toEqual(store.getState().capabilities);

    expect(await service.startRecording()).toBe(false);
    expect(await service.zoomIn()).toBe(false);
    expect(errors).toEqual([]);
    expect(store.getState().status.error).toBeNull();

    expect(await service.goToZone('CENTER')).toBe(true);
    expect(gimbal.getHistory()).toEqual(['connect', 'goToPosition(0,0,1500)']);
  });

  it('el dummy rechaza con UNSUPPORTED una orden fuera de sus capacidades sin cambiar de estado', async () => {
    const camera = createDummyCameraController({ now: () => 1, capabilities: { pan: false } });
    await camera.connect();
    await expect(camera.recenter()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(camera.goToPosition({ pan: 10, tilt: 0 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(camera.getStatus().position).toBeNull();
    expect(camera.getStatus().connection).toBe('connected');
  });

  it('al soltar el controlador las capacidades desaparecen del store', async () => {
    const dummy = createDummyCameraController({ now: () => 1 });
    const store = createCameraStore(ZONES);
    const service = createCameraService({ bus: createEventBus<CameraEventMap>(), store, controller: dummy, now: () => 1 });
    expect(store.getState().capabilities).toEqual({ record: true, pause: true, pan: true, zoom: true });
    await service.detachController();
    expect(store.getState().capabilities).toBeNull();
    expect(service.getCapabilities()).toBeNull();
  });

  it('la automatización hace STOP + REC en el descanso cuando el dispositivo no sabe pausar', async () => {
    const sony = createDummyCameraController({ now: () => 1, capabilities: { pause: false, pan: false } });
    const bus = createEventBus<MatchBusEventMap & CameraEventMap>();
    let n = 0;
    const store = createCameraStore({ ...ZONES, deviceType: 'sony_a6600' });
    const service = createCameraService({ bus, store, controller: sony, now: () => 1, newId: () => `rec-${++n}` });
    const topics: string[] = [];
    for (const topic of ['camera.record.started', 'camera.record.paused', 'camera.record.resumed', 'camera.record.stopped'] as const) {
      bus.on(topic, () => topics.push(topic));
    }
    await service.connect();
    const stop = createCameraAutomation(bus, service);

    const payload = { matchId: 'm', timestamp: 1, period: 1 };
    bus.emit('match.started', payload);
    await flush();
    bus.emit('match.halftime', payload);
    await flush();
    bus.emit('match.period.started', { ...payload, period: 2 });
    await flush();
    bus.emit('match.finished', { matchId: 'm', timestamp: 1, reason: 'NORMAL' });
    await flush();

    expect(topics).toEqual(['camera.record.started', 'camera.record.stopped', 'camera.record.started', 'camera.record.stopped']);
    expect(sony.getHistory()).toEqual(['connect', 'startRecording', 'stopRecording', 'startRecording', 'stopRecording']);
    stop();
  });

  it('tipado: la automatización acepta un bus con solo los temas del reloj (no arrastra tipos de core)', () => {
    const clockBus: EventBus<ClockBusEventMap> = createEventBus<ClockBusEventMap>();
    const stop = createCameraAutomation(clockBus, {} as never);
    expect(clockBus.listenerCount('match.started')).toBe(1);
    stop();
    expect(clockBus.listenerCount('match.started')).toBe(0);
  });
});
