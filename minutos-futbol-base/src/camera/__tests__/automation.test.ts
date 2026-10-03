import { createEventBus } from '../../events/bus';
import { createCameraAutomation, type AppBusEventMap } from '../automation';
import type { CameraService } from '../cameraService';

/** Servicio falso: solo registra qué operación se pidió. */
function fakeService() {
  const calls: string[] = [];
  const operation = (name: string) => async () => {
    calls.push(name);
    return true;
  };
  const service = {
    startRecording: operation('startRecording'),
    pauseRecording: operation('pauseRecording'),
    resumeRecording: operation('resumeRecording'),
    stopRecording: operation('stopRecording'),
  } as unknown as CameraService;
  return { service, calls };
}

const base = { matchId: 'm1', timestamp: 1_000, period: 1 };

describe('createCameraAutomation (dormida en el MVP)', () => {
  it('traduce los cuatro temas del reloj a operaciones de grabación', () => {
    const bus = createEventBus<AppBusEventMap>();
    const { service, calls } = fakeService();
    createCameraAutomation(bus, service);

    bus.emit('match.started', base);
    bus.emit('match.halftime', base);
    bus.emit('match.period.started', { ...base, period: 2 });
    bus.emit('match.finished', { matchId: 'm1', timestamp: 2_000, reason: 'NORMAL' });

    expect(calls).toEqual(['startRecording', 'pauseRecording', 'resumeRecording', 'stopRecording']);
  });

  it('ignora el resto de temas del partido', () => {
    const bus = createEventBus<AppBusEventMap>();
    const { service, calls } = fakeService();
    createCameraAutomation(bus, service);

    bus.emit('match.paused', base);
    bus.emit('match.resumed', base);
    bus.emit('player.entered', { matchId: 'm1', playerId: 'p1', timestamp: 1_000, matchTimeMs: 0 });

    expect(calls).toEqual([]);
  });

  it('tras desuscribir no reacciona y no deja suscriptores en el bus', () => {
    const bus = createEventBus<AppBusEventMap>();
    const { service, calls } = fakeService();
    const stop = createCameraAutomation(bus, service);
    bus.emit('match.started', base);

    stop();
    bus.emit('match.started', base);
    bus.emit('match.halftime', base);
    bus.emit('match.period.started', base);
    bus.emit('match.finished', { matchId: 'm1', timestamp: 2_000, reason: 'SUSPENDED' });

    expect(calls).toEqual(['startRecording']);
    for (const topic of ['match.started', 'match.halftime', 'match.period.started', 'match.finished'] as const) {
      expect(bus.listenerCount(topic)).toBe(0);
    }
  });

  it('un servicio que devuelve false no rompe la entrega a otros suscriptores', () => {
    const bus = createEventBus<AppBusEventMap>();
    const service = { startRecording: async () => false } as unknown as CameraService;
    createCameraAutomation(bus, service);
    const other = jest.fn();
    bus.on('match.started', other);

    expect(() => bus.emit('match.started', base)).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
