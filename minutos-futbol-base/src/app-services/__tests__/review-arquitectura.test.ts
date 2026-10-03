import {
  createCameraAutomation,
  createCameraService,
  createCameraStore,
  createDummyCameraController,
  type CameraController,
  type CameraSettings,
} from '../../camera';
import { MINUTE, T0, f7Config, pos } from '../../core/__tests__/helpers';
import type { LineupEntry } from '../../core';
import { createInMemoryEventStore } from '../../db';
import { createMatchSession } from '../createMatchSession';
import { createEventBus } from '../../events/bus';
import { createCameraTimelineBridge } from '../cameraTimelineBridge';
import { createMatchEngine, type AppBusEventMap } from '../matchEngine';

/**
 * REVISIÓN (arquitectura y desacoplamiento). Tests de evidencia:
 * - el primero DEMUESTRA UN BUG en el orden de `dispose()` y falla a propósito;
 * - el segundo comprueba que un controlador colgado no bloquea el partido.
 */

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const lineup = (ids: readonly string[]): LineupEntry[] => ids.map((playerId, i) => ({ playerId, position: pos(i) }));

const ZONES_SETTINGS: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  deviceType: 'dummy',
  zones: { FAR_LEFT: null, LEFT: null, CENTER: { pan: 0, tilt: 0 }, RIGHT: null, FAR_RIGHT: null },
};

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function clockAndIds() {
  let t = T0;
  let n = 0;
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
    newId: () => `id-${String(++n).padStart(3, '0')}`,
  };
}

describe('review-arquitectura: createMatchSession', () => {
  it('BUG: dispose() con grabación en curso para la cámara pero deja la grabación ABIERTA en la timeline', async () => {
    const clock = clockAndIds();
    const dummy = createDummyCameraController({ now: clock.now });
    const session = createMatchSession({
      config: f7Config(),
      store: createInMemoryEventStore(),
      cameraSettings: ZONES_SETTINGS,
      cameraController: dummy,
      now: clock.now,
      newId: clock.newId,
    });
    await session.engine.load();
    await session.engine.setLineup(lineup(FIELD), [...SUBS]);
    await session.engine.start();
    await session.camera.connect();
    clock.set(T0 + 3 * MINUTE);
    await session.camera.startRecording();
    await settle();

    clock.set(T0 + 5 * MINUTE);
    await session.dispose();
    await settle();

    // La cámara SÍ paró la grabación (el servicio publicó camera.record.stopped al desconectar)...
    expect(dummy.getStatus().recording).toBe('idle');
    // ...pero `unbridge()` se ejecuta ANTES de `camera.dispose()`, así que ese
    // evento nunca llega a la timeline: CAMERA_RECORDING_STARTED queda sin cierre
    // y cualquier evento posterior se atribuiría a una grabación que ya no existe.
    const cameraTypes = session.engine.getTimeline().filter((e) => e.type.startsWith('CAMERA_')).map((e) => e.type);
    expect(cameraTypes).toEqual(['CAMERA_RECORDING_STARTED', 'CAMERA_RECORDING_STOPPED']);
  });

  it('un controlador colgado no bloquea ningún comando del partido, ni siquiera con la automatización registrada', async () => {
    const clock = clockAndIds();
    const dummy = createDummyCameraController({ now: clock.now });
    // Simula un dispositivo (BLE, red) cuyas promesas no resuelven nunca.
    const never = () => new Promise<void>(() => undefined);
    const hung: CameraController = { ...dummy, startRecording: never, pauseRecording: never, stopRecording: never };
    const session = createMatchSession({
      config: f7Config(),
      store: createInMemoryEventStore(),
      cameraSettings: ZONES_SETTINGS,
      cameraController: hung,
      now: clock.now,
      newId: clock.newId,
    });
    const stopAutomation = createCameraAutomation(session.bus, session.camera);
    await session.camera.connect();
    await session.engine.load();
    await session.engine.setLineup(lineup(FIELD), [...SUBS]);

    await session.engine.start();
    clock.set(T0 + 10 * MINUTE);
    await session.engine.substitute('hugo', 'lucas');
    clock.set(T0 + 25 * MINUTE);
    await session.engine.startHalftime();
    clock.set(T0 + 40 * MINUTE);
    await session.engine.startNextPeriod();
    clock.set(T0 + 65 * MINUTE);
    await session.engine.end();

    expect(session.engine.getState().status).toBe('FINISHED');
    expect(session.engine.playedMs('lucas')).toBe(10 * MINUTE);
    expect(session.engine.playedMs('hugo')).toBe(40 * MINUTE);
    expect(session.engine.getTimeline().some((e) => e.type.startsWith('CAMERA_'))).toBe(false);
    stopAutomation();
  });
});

describe('review-arquitectura: verificación del arreglo propuesto para dispose()', () => {
  it('liberando la cámara ANTES de desuscribir el puente, la timeline cierra la grabación', async () => {
    const clock = clockAndIds();
    const dummy = createDummyCameraController({ now: clock.now });
    const bus = createEventBus<AppBusEventMap>();
    const engine = createMatchEngine({ config: f7Config(), store: createInMemoryEventStore(), bus, now: clock.now, newId: clock.newId });
    const cameraStore = createCameraStore(ZONES_SETTINGS);
    const camera = createCameraService({ bus, store: cameraStore, controller: dummy, now: clock.now, newId: clock.newId });
    const unbridge = createCameraTimelineBridge(bus, engine);

    await engine.load();
    await engine.setLineup(lineup(FIELD), [...SUBS]);
    await engine.start();
    await camera.connect();
    clock.set(T0 + 3 * MINUTE);
    await camera.startRecording();
    await settle();

    clock.set(T0 + 5 * MINUTE);
    // Orden invertido respecto a createMatchSession.dispose(): primero la cámara, después el puente.
    await camera.dispose();
    unbridge();
    await settle();

    const cameraEvents = engine.getTimeline().filter((e) => e.type.startsWith('CAMERA_'));
    expect(cameraEvents.map((e) => [e.type, e.timestamp])).toEqual([
      ['CAMERA_RECORDING_STARTED', T0 + 3 * MINUTE],
      ['CAMERA_RECORDING_STOPPED', T0 + 5 * MINUTE],
    ]);
    expect(bus.listenerCount('camera.record.stopped')).toBe(0);
  });
});
