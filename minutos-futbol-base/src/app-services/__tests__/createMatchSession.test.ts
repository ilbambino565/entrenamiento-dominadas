import { createDummyCameraController, type CameraSettings } from '../../camera';
import { checkInvariants, type LineupEntry } from '../../core';
import { MINUTE, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { createInMemoryEventStore } from '../../db';
import { createMatchSession } from '../createMatchSession';

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const lineup = (ids: readonly string[]): LineupEntry[] => ids.map((playerId, i) => ({ playerId, position: pos(i) }));

const ZONES_SETTINGS: Partial<CameraSettings> = {
  enabled: true,
  mode: 'zones',
  deviceType: 'dummy',
  zones: { FAR_LEFT: null, LEFT: null, CENTER: { pan: 0, tilt: 0 }, RIGHT: null, FAR_RIGHT: null },
};

/** El puente registra en la timeline de forma asíncrona (cola del motor): deja pasar un tick. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(cameraSettings?: Partial<CameraSettings> | null, withDummy = false) {
  let t = T0;
  const clock = {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
  };
  let n = 0;
  const newId = () => `id-${String(++n).padStart(3, '0')}`;
  const store = createInMemoryEventStore();
  const dummy = withDummy ? createDummyCameraController({ now: clock.now }) : undefined;
  const session = createMatchSession({
    config: f7Config(),
    store,
    cameraSettings,
    cameraController: dummy,
    now: clock.now,
    newId,
  });
  return { session, store, clock, dummy };
}

async function startMatch(session: ReturnType<typeof setup>['session'], clock: { set: (ms: number) => void }) {
  await session.engine.load();
  await session.engine.setLineup(lineup(FIELD), [...SUBS]);
  clock.set(T0);
  await session.engine.start();
}

describe('createMatchSession', () => {
  describe('sin cameraSettings (MVP)', () => {
    it('la cámara queda en modo external y no disponible: toda operación devuelve false', async () => {
      const { session } = setup();
      const { settings, available, controllerAttached } = session.cameraStore.getState();
      expect(settings).toMatchObject({ enabled: false, mode: 'external', deviceType: null, autoRecord: false });
      expect(available).toBe(false);
      expect(controllerAttached).toBe(false);

      expect(await session.camera.connect()).toBe(false);
      expect(await session.camera.startRecording()).toBe(false);
      expect(await session.camera.goToZone('CENTER')).toBe(false);
      expect(await session.camera.zoomIn()).toBe(false);
      expect(session.camera.getStatus().connection).toBe('disconnected');
    });

    it('el partido funciona igual y la timeline no tiene ningún evento CAMERA_*', async () => {
      const { session, clock } = setup();
      await startMatch(session, clock);
      clock.set(T0 + 10 * MINUTE);
      await session.engine.substitute('hugo', 'lucas');
      await session.camera.startRecording();
      await session.camera.stopRecording();
      await settle();

      expect(session.engine.getState().status).toBe('RUNNING');
      expect(session.engine.playedMs('lucas', T0 + 12 * MINUTE)).toBe(10 * MINUTE);
      expect(session.engine.getTimeline().map((e) => e.type)).toEqual(['LINEUP_SET', 'MATCH_STARTED', 'SUBSTITUTION']);
      expect(session.engine.getTimeline().some((e) => e.type.startsWith('CAMERA_'))).toBe(false);
    });

    it('acepta cameraSettings null y un bus externo', async () => {
      const { session } = setup(null);
      expect(session.cameraStore.getState().settings.mode).toBe('external');
      const { session: shared } = setup(undefined);
      expect(shared.bus.listenerCount('camera.record.started')).toBe(1); // el puente
    });
  });

  describe('con cameraSettings en modo zones y un dummy', () => {
    it('la grabación y las zonas quedan en la timeline con source camera sin alterar el partido', async () => {
      const { session, clock, dummy } = setup(ZONES_SETTINGS, true);
      await startMatch(session, clock);
      expect(session.cameraStore.getState().available).toBe(true);

      clock.set(T0 + 2 * MINUTE);
      expect(await session.camera.connect()).toBe(true);
      clock.set(T0 + 3 * MINUTE);
      expect(await session.camera.startRecording()).toBe(true);
      clock.set(T0 + 4 * MINUTE);
      expect(await session.camera.goToZone('CENTER')).toBe(true);
      clock.set(T0 + 5 * MINUTE);
      expect(await session.camera.stopRecording()).toBe(true);
      await settle();

      const cameraEvents = session.engine.getTimeline().filter((e) => e.type.startsWith('CAMERA_'));
      expect(cameraEvents.map((e) => [e.type, e.source, e.timestamp, e.matchTimeMs, e.period])).toEqual([
        ['CAMERA_RECORDING_STARTED', 'camera', T0 + 3 * MINUTE, 3 * MINUTE, 1],
        ['CAMERA_ZONE_CHANGED', 'camera', T0 + 4 * MINUTE, 4 * MINUTE, 1],
        ['CAMERA_RECORDING_STOPPED', 'camera', T0 + 5 * MINUTE, 5 * MINUTE, 1],
      ]);
      const [started, zone, stopped] = cameraEvents;
      const recordingId = (started?.metadata as { recordingId: string }).recordingId;
      expect(started?.metadata).toEqual({ recordingId, deviceType: 'dummy' });
      expect(zone?.metadata).toEqual({ zone: 'CENTER', previousZone: null });
      expect(stopped?.metadata).toEqual({ recordingId });
      expect(cameraEvents.map((e) => e.seq)).toEqual([3, 4, 5]);
      expect(dummy?.getHistory()).toEqual(['connect', 'startRecording', 'goToPosition(0,0,1500)', 'stopRecording']);

      // El partido ni se entera: mismos minutos, mismo estado (salvo lastSeq).
      const state = session.engine.getState();
      expect(state.status).toBe('RUNNING');
      expect(state.clockSegments).toEqual([{ period: 1, startedAt: T0, endedAt: null }]);
      expect(state.intervals).toHaveLength(7);
      for (const id of FIELD) expect(session.engine.playedMs(id, T0 + 10 * MINUTE)).toBe(10 * MINUTE);
      for (const id of SUBS) expect(session.engine.playedMs(id, T0 + 10 * MINUTE)).toBe(0);
      expect(checkInvariants(state)).toEqual([]);
      // Los eventos de cámara no se deshacen: lo siguiente en la pila es el inicio.
      expect(session.engine.peekUndo()?.type).toBe('MATCH_STARTED');
    });

    it('la automatización NO está registrada: iniciar el partido no arranca la grabación', async () => {
      const { session, clock, dummy } = setup(ZONES_SETTINGS, true);
      await session.camera.connect();
      await startMatch(session, clock);
      clock.set(T0 + 25 * MINUTE);
      await session.engine.startHalftime();
      await settle();

      expect(session.bus.listenerCount('match.started')).toBe(0);
      expect(session.bus.listenerCount('match.halftime')).toBe(0);
      expect(session.camera.getStatus().recording).toBe('idle');
      expect(dummy?.getHistory()).toEqual(['connect']);
      expect(session.engine.getTimeline().some((e) => e.type.startsWith('CAMERA_'))).toBe(false);
    });

    it('un evento de cámara antes de load() no rompe nada: se avisa y se sigue', async () => {
      const { session, clock } = setup(ZONES_SETTINGS, true);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await session.camera.connect();
      await session.camera.startRecording();
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(session.camera.getStatus().recording).toBe('recording');

      await startMatch(session, clock);
      expect(session.engine.getTimeline().map((e) => e.type)).toEqual(['LINEUP_SET', 'MATCH_STARTED']);
      warn.mockRestore();
    });

    it('dispose desuscribe el puente y libera la cámara', async () => {
      const { session, clock, dummy } = setup(ZONES_SETTINGS, true);
      await startMatch(session, clock);
      await session.camera.connect();
      await session.camera.startRecording();
      await settle();
      const before = session.engine.getTimeline().length;

      await session.dispose();

      for (const topic of [
        'camera.record.started',
        'camera.record.paused',
        'camera.record.resumed',
        'camera.record.stopped',
        'camera.zone.changed',
      ] as const) {
        expect(session.bus.listenerCount(topic)).toBe(0);
      }
      expect(dummy?.getStatus().connection).toBe('disconnected');
      expect(session.cameraStore.getState()).toMatchObject({ controllerAttached: false, available: false });
      expect(await session.camera.startRecording()).toBe(false);
      await settle();
      // La grabación se cerró al desconectar, pero el puente ya no escuchaba.
      expect(session.engine.getTimeline()).toHaveLength(before);
      // El motor sigue vivo: la timeline no es cosa de la cámara.
      clock.set(T0 + MINUTE);
      await session.engine.pause();
      expect(session.engine.getState().status).toBe('PAUSED');
    });
  });
});
