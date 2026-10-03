import { createEventBus, type EventBus } from '../bus';
import type { AppEventMap, MatchBusEventMap } from '../topics';
import type { CameraEventMap } from '../../camera/types';

/**
 * Los mapas de temas del contrato son `interface` (sin firma de índice
 * implícita). El bus debe aceptarlos tal cual: si no, cada módulo acabaría
 * con su propia copia mapeada del mismo tipo.
 */
describe('EventBus: tipado con los mapas del contrato', () => {
  it('acepta AppEventMap, MatchBusEventMap y CameraEventMap directamente', () => {
    const app: EventBus<AppEventMap> = createEventBus<AppEventMap>();
    const match: EventBus<MatchBusEventMap> = createEventBus<MatchBusEventMap>();
    const camera: EventBus<CameraEventMap> = createEventBus<CameraEventMap>();

    const seen: string[] = [];
    app.on('match.started', ({ period }) => seen.push(`p${period}`));
    app.on('camera.record.started', ({ recordingId }) => seen.push(recordingId));
    app.emit('match.started', { matchId: 'm', timestamp: 1, period: 1 });
    app.emit('camera.record.started', { recordingId: 'r1', deviceType: 'dummy', timestamp: 2 });

    expect(seen).toEqual(['p1', 'r1']);
    expect(match.listenerCount('match.paused')).toBe(0);
    expect(camera.listenerCount('camera.error')).toBe(0);
  });

  it('un bus con más temas sirve donde se pide uno con menos: la cámara recibe el bus de la app', () => {
    const app = createEventBus<AppEventMap>();
    const asCamera: EventBus<CameraEventMap> = app;
    const asMatch: EventBus<MatchBusEventMap> = app;
    expect(asCamera).toBe(app);
    expect(asMatch).toBe(app);
  });

  it('rechaza en compilación los temas que no existen', () => {
    const app = createEventBus<AppEventMap>();
    // @ts-expect-error 'match.exploded' no es un tema de AppEventMap
    expect(() => app.emit('match.exploded', {})).not.toThrow();
  });
});
