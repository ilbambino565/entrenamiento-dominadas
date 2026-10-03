import { createDummyCameraController } from '../dummyCameraController';
import { CameraError, type CameraStatus } from '../types';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

async function expectCameraError(promise: Promise<unknown>, code: CameraError['code']) {
  await expect(promise).rejects.toBeInstanceOf(CameraError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function connected(options: Parameters<typeof createDummyCameraController>[0] = {}) {
  const controller = createDummyCameraController(options);
  await controller.connect();
  return controller;
}

describe('createDummyCameraController', () => {
  it('estado inicial: dummy, desconectado, sin zona ni grabación', () => {
    const { now } = clock(500);
    const controller = createDummyCameraController({ now });
    expect(controller.deviceType).toBe('dummy');
    expect(controller.getStatus()).toEqual<CameraStatus>({
      connection: 'disconnected',
      recording: 'idle',
      recordingId: null,
      zone: null,
      position: null,
      zoom: 0,
      panning: null,
      error: null,
      updatedAt: 500,
    });
    expect(controller.getHistory()).toEqual([]);
  });

  it('initialPosition se copia y fija el zoom inicial (acotado)', () => {
    const initialPosition = { pan: 10, tilt: -5, zoom: 1.7 };
    const controller = createDummyCameraController({ initialPosition });
    const status = controller.getStatus();
    expect(status.position).toEqual({ pan: 10, tilt: -5, zoom: 1 });
    expect(status.position).not.toBe(initialPosition);
    expect(status.zoom).toBe(1);
  });

  describe('conexión', () => {
    it('connect sin latencia notifica connecting y connected en el mismo tick', async () => {
      const { now, advance } = clock();
      const controller = createDummyCameraController({ now });
      const seen: Array<[CameraStatus['connection'], number]> = [];
      controller.subscribe((s) => seen.push([s.connection, s.updatedAt]));

      advance(10);
      let settled = false;
      const pending = controller.connect().then(() => (settled = true));
      expect(seen).toEqual([
        ['connecting', 1_010],
        ['connected', 1_010],
      ]);
      await pending;
      expect(settled).toBe(true);
      expect(controller.getStatus().connection).toBe('connected');
      expect(controller.getHistory()).toEqual(['connect']);
    });

    it('connect con latencia espera antes de pasar a connected', async () => {
      jest.useFakeTimers();
      try {
        const controller = createDummyCameraController({ latencyMs: 50 });
        const pending = controller.connect();
        expect(controller.getStatus().connection).toBe('connecting');
        jest.advanceTimersByTime(49);
        expect(controller.getStatus().connection).toBe('connecting');
        jest.advanceTimersByTime(1);
        await pending;
        expect(controller.getStatus().connection).toBe('connected');
      } finally {
        jest.useRealTimers();
      }
    });

    it('disconnect durante la espera de connect gana: no se resucita la conexión', async () => {
      jest.useFakeTimers();
      try {
        const controller = createDummyCameraController({ latencyMs: 50 });
        const pending = controller.connect();
        await controller.disconnect();
        jest.advanceTimersByTime(50);
        await pending;
        expect(controller.getStatus().connection).toBe('disconnected');
      } finally {
        jest.useRealTimers();
      }
    });

    it('conectar dos veces → ALREADY_CONNECTED', async () => {
      const controller = await connected();
      await expectCameraError(controller.connect(), 'ALREADY_CONNECTED');
    });

    it('disconnect para la grabación sin lanzar y deja disconnected', async () => {
      const controller = await connected();
      await controller.startRecording();
      await controller.panLeft();
      await expect(controller.disconnect()).resolves.toBeUndefined();
      expect(controller.getStatus()).toMatchObject({
        connection: 'disconnected',
        recording: 'idle',
        panning: null,
      });
    });

    it('tras un error se puede volver a conectar y el error se limpia', async () => {
      const controller = await connected();
      controller.simulateError('Batería agotada');
      expect(controller.getStatus()).toMatchObject({ connection: 'error', error: 'Batería agotada' });
      await controller.connect();
      expect(controller.getStatus()).toMatchObject({ connection: 'connected', error: null });
    });
  });

  describe('sin conexión', () => {
    it('toda operación distinta de connect/getStatus/subscribe → NOT_CONNECTED', async () => {
      const controller = createDummyCameraController();
      const operations: Array<() => Promise<void>> = [
        () => controller.startRecording(),
        () => controller.pauseRecording(),
        () => controller.resumeRecording(),
        () => controller.stopRecording(),
        () => controller.panLeft(),
        () => controller.panRight(),
        () => controller.stopPan(),
        () => controller.recenter(),
        () => controller.goToPosition({ pan: 0, tilt: 0 }),
        () => controller.zoomIn(),
        () => controller.zoomOut(),
        () => controller.setZoom(0.5),
      ];
      for (const operation of operations) await expectCameraError(operation(), 'NOT_CONNECTED');
      expect(controller.getHistory()).toHaveLength(operations.length);
      expect(controller.getStatus().connection).toBe('disconnected');
    });

    it('también tras simulateError', async () => {
      const controller = await connected();
      controller.simulateError('kaput');
      await expectCameraError(controller.startRecording(), 'NOT_CONNECTED');
    });
  });

  describe('grabación', () => {
    it('idle → recording → paused → recording → idle', async () => {
      const controller = await connected();
      await controller.startRecording();
      expect(controller.getStatus().recording).toBe('recording');
      await controller.pauseRecording();
      expect(controller.getStatus().recording).toBe('paused');
      await controller.resumeRecording();
      expect(controller.getStatus().recording).toBe('recording');
      await controller.stopRecording();
      expect(controller.getStatus().recording).toBe('idle');
      expect(controller.getHistory()).toEqual([
        'connect',
        'startRecording',
        'pauseRecording',
        'resumeRecording',
        'stopRecording',
      ]);
    });

    it('stop también desde paused', async () => {
      const controller = await connected();
      await controller.startRecording();
      await controller.pauseRecording();
      await controller.stopRecording();
      expect(controller.getStatus().recording).toBe('idle');
    });

    it('transiciones inválidas: ALREADY_RECORDING y NOT_RECORDING', async () => {
      const controller = await connected();
      await expectCameraError(controller.pauseRecording(), 'NOT_RECORDING');
      await expectCameraError(controller.resumeRecording(), 'NOT_RECORDING');
      await expectCameraError(controller.stopRecording(), 'NOT_RECORDING');

      await controller.startRecording();
      await expectCameraError(controller.startRecording(), 'ALREADY_RECORDING');
      await expectCameraError(controller.resumeRecording(), 'NOT_RECORDING');

      await controller.pauseRecording();
      await expectCameraError(controller.pauseRecording(), 'NOT_RECORDING');
      await expectCameraError(controller.startRecording(), 'ALREADY_RECORDING');
      expect(controller.getStatus().recording).toBe('paused');
    });

    it('el controlador nunca rellena recordingId ni zone', async () => {
      const controller = await connected();
      await controller.startRecording();
      await controller.goToPosition({ pan: 10, tilt: 0 });
      expect(controller.getStatus().recordingId).toBeNull();
      expect(controller.getStatus().zone).toBeNull();
    });
  });

  describe('movimiento', () => {
    it('panLeft/panRight fijan panning y stopPan lo anula', async () => {
      const controller = await connected();
      await controller.panLeft();
      expect(controller.getStatus().panning).toBe('left');
      await controller.panRight();
      expect(controller.getStatus().panning).toBe('right');
      await controller.stopPan();
      expect(controller.getStatus().panning).toBeNull();
    });

    it('recenter → pan 0, tilt 0, zoom actual y sin panning', async () => {
      const controller = await connected({ initialPosition: { pan: 20, tilt: 3, zoom: 0.4 } });
      await controller.panLeft();
      await controller.recenter();
      expect(controller.getStatus()).toMatchObject({
        position: { pan: 0, tilt: 0, zoom: 0.4 },
        zoom: 0.4,
        panning: null,
      });
    });

    it('goToPosition fija la posición, anula el panning y registra la transición', async () => {
      const controller = await connected();
      await controller.panRight();
      await controller.goToPosition({ pan: -30, tilt: 5 }, 1500);
      expect(controller.getStatus()).toMatchObject({
        position: { pan: -30, tilt: 5, zoom: 0 },
        panning: null,
      });
      await controller.goToPosition({ pan: 30, tilt: 0, zoom: 0.6 });
      expect(controller.getStatus()).toMatchObject({
        position: { pan: 30, tilt: 0, zoom: 0.6 },
        zoom: 0.6,
      });
      expect(controller.getHistory()).toEqual([
        'connect',
        'panRight',
        'goToPosition(-30,5,1500)',
        'goToPosition(30,0,0)',
      ]);
    });
  });

  describe('zoom', () => {
    it('zoomIn/zoomOut ± 0.1 acotado a 0..1 y sin arrastre de decimales', async () => {
      const controller = await connected();
      await controller.zoomOut();
      expect(controller.getStatus().zoom).toBe(0);
      await controller.zoomIn();
      await controller.zoomIn();
      await controller.zoomIn();
      expect(controller.getStatus().zoom).toBe(0.3);
      for (let i = 0; i < 10; i++) await controller.zoomIn();
      expect(controller.getStatus().zoom).toBe(1);
    });

    it('zoomStep personalizado', async () => {
      const controller = await connected({ zoomStep: 0.25 });
      await controller.zoomIn();
      await controller.zoomIn();
      expect(controller.getStatus().zoom).toBe(0.5);
    });

    it('setZoom acota a 0..1 y rechaza NaN con UNSUPPORTED', async () => {
      const controller = await connected({ initialPosition: { pan: 0, tilt: 0 } });
      await controller.setZoom(0.5);
      expect(controller.getStatus().zoom).toBe(0.5);
      expect(controller.getStatus().position?.zoom).toBe(0.5);
      await controller.setZoom(2);
      expect(controller.getStatus().zoom).toBe(1);
      await controller.setZoom(-1);
      expect(controller.getStatus().zoom).toBe(0);
      await expectCameraError(controller.setZoom(Number.NaN), 'UNSUPPORTED');
      await expectCameraError(controller.setZoom(Number.POSITIVE_INFINITY), 'UNSUPPORTED');
      expect(controller.getStatus().zoom).toBe(0);
    });
  });

  describe('estado y suscripción', () => {
    it('getStatus devuelve una copia independiente', async () => {
      const controller = await connected({ initialPosition: { pan: 1, tilt: 1 } });
      const status = controller.getStatus();
      status.connection = 'error';
      if (status.position) status.position.pan = 99;
      expect(controller.getStatus().connection).toBe('connected');
      expect(controller.getStatus().position?.pan).toBe(1);
    });

    it('subscribe notifica tras cada cambio con una copia y updatedAt = now()', async () => {
      const { now, advance } = clock(2_000);
      const controller = createDummyCameraController({ now });
      const seen: CameraStatus[] = [];
      const unsubscribe = controller.subscribe((s) => seen.push(s));

      await controller.connect();
      advance(5);
      await controller.panLeft();
      expect(seen.map((s) => s.updatedAt)).toEqual([2_000, 2_000, 2_005]);
      expect(seen[2]?.panning).toBe('left');

      // Mutar lo recibido no toca el estado del controlador.
      if (seen[2]) seen[2].panning = null;
      expect(controller.getStatus().panning).toBe('left');

      unsubscribe();
      await controller.stopPan();
      expect(seen).toHaveLength(3);
    });

    it('cada suscriptor recibe su propia copia', async () => {
      const controller = createDummyCameraController();
      const first: CameraStatus[] = [];
      const second: CameraStatus[] = [];
      controller.subscribe((s) => first.push(s));
      controller.subscribe((s) => second.push(s));
      await controller.connect();
      expect(first[0]).toEqual(second[0]);
      expect(first[0]).not.toBe(second[0]);
    });
  });

  describe('ayudas de desarrollo', () => {
    it('simulateError pone connection error, guarda el mensaje, para la grabación y notifica', async () => {
      const controller = await connected();
      await controller.startRecording();
      const listener = jest.fn();
      controller.subscribe(listener);

      controller.simulateError('Se perdió el gimbal');
      expect(controller.getStatus()).toMatchObject({
        connection: 'error',
        recording: 'idle',
        panning: null,
        error: 'Se perdió el gimbal',
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({ connection: 'error' });
    });

    it('simulateDisconnect deja disconnected sin error y para la grabación', async () => {
      const controller = await connected();
      await controller.startRecording();
      controller.simulateDisconnect();
      expect(controller.getStatus()).toMatchObject({
        connection: 'disconnected',
        recording: 'idle',
        error: null,
      });
    });

    it('las simulaciones no aparecen en el historial', async () => {
      const controller = await connected();
      controller.simulateError('x');
      controller.simulateDisconnect();
      expect(controller.getHistory()).toEqual(['connect']);
    });

    it('getHistory devuelve una copia', async () => {
      const controller = await connected();
      controller.getHistory().push('fake');
      expect(controller.getHistory()).toEqual(['connect']);
    });

    it('reset vuelve al estado inicial, vacía el historial y conserva suscriptores', async () => {
      const controller = await connected({ initialPosition: { pan: 5, tilt: 5 } });
      await controller.startRecording();
      await controller.goToPosition({ pan: 40, tilt: 0 });
      const listener = jest.fn();
      controller.subscribe(listener);

      controller.reset();
      expect(controller.getStatus()).toMatchObject({
        connection: 'disconnected',
        recording: 'idle',
        position: { pan: 5, tilt: 5, zoom: 0 },
        error: null,
      });
      expect(controller.getHistory()).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(1);

      await controller.connect();
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
