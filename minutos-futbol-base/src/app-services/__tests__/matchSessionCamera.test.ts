import type { AppEventMap } from '../../events/topics';
import {
  createCameraAutomation,
  createDummyCameraController,
  type CameraController,
  type CameraSettings,
} from '../../camera';
import { MINUTE, T0, f7Config, pos } from '../../core/__tests__/helpers';
import type { LineupEntry } from '../../core';
import { createInMemoryEventStore } from '../../db';
import { createMatchSession } from '../createMatchSession';
import { createEventBus } from '../../events/bus';

/**
 * Sesión de partido con cámara: el orden de `dispose()` (primero la cámara,
 * después el puente) y la garantía de que la cámara nunca bloquea el partido.
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

describe('createMatchSession con cámara', () => {
  it('dispose() con una grabación en curso la para y la cierra también en la timeline', async () => {
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

    // La cámara paró la grabación (el servicio publicó camera.record.stopped al
    // desconectar) y, como el puente seguía escuchando, la timeline la cerró:
    // ningún evento posterior se atribuirá a una grabación que ya no existe.
    expect(dummy.getStatus().recording).toBe('idle');
    const cameraEvents = session.engine.getTimeline().filter((e) => e.type.startsWith('CAMERA_'));
    expect(cameraEvents.map((e) => [e.type, e.timestamp])).toEqual([
      ['CAMERA_RECORDING_STARTED', T0 + 3 * MINUTE],
      ['CAMERA_RECORDING_STOPPED', T0 + 5 * MINUTE],
    ]);
    expect(session.bus.listenerCount('camera.record.stopped')).toBe(0);
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

  it('con un bus compartido, dispose() solo retira las suscripciones de la sesión', async () => {
    const clock = clockAndIds();
    const shared = createEventBus<AppEventMap>();
    const foreign = jest.fn();
    shared.on('camera.record.started', foreign);
    const session = createMatchSession({
      config: f7Config(),
      store: createInMemoryEventStore(),
      cameraSettings: null,
      bus: shared,
      now: clock.now,
      newId: clock.newId,
    });
    expect(session.bus).toBe(shared);
    // El puente escucha los cinco temas de cámara aunque la cámara esté deshabilitada.
    expect(shared.listenerCount('camera.record.started')).toBe(2);
    expect(shared.listenerCount('camera.zone.changed')).toBe(1);

    await session.dispose();
    expect(shared.listenerCount('camera.record.started')).toBe(1);
    expect(shared.listenerCount('camera.zone.changed')).toBe(0);
    shared.emit('camera.record.started', { recordingId: 'r', deviceType: null, timestamp: T0 });
    expect(foreign).toHaveBeenCalledTimes(1);
  });
});
