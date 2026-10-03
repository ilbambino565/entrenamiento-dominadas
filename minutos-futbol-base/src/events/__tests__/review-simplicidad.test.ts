import { createEventBus, type EventBus } from '../bus';
import type { AppEventMap, MatchBusEventMap } from '../topics';
import type { CameraEventMap } from '../../camera/types';

/**
 * REVISIÓN (simplicidad): evidencia del defecto de contrato que obliga a
 * definir TRES tipos mapeados idénticos fuera de `events/`:
 *
 *   src/app-services/matchEngine.ts  export type AppBusEventMap = { [K in keyof AppEventMap]: AppEventMap[K] }
 *   src/camera/automation.ts         export type AppBusEventMap = { [K in keyof AppEventMap]: AppEventMap[K] }
 *   src/camera/cameraService.ts      export type CameraBusEventMap = { [K in keyof CameraEventMap]: CameraEventMap[K] }
 *
 * `EventBus<TMap extends Record<string, unknown>>` rechaza una `interface`
 * (sin firma de índice implícita) y, por tanto, la intersección `AppEventMap`.
 * Si `topics.ts` declarase `MatchBusEventMap`/`AppEventMap` como `type` (o
 * `bus.ts` relajase la restricción a `object`), las tres copias sobrarían y los
 * tests no tendrían que elegir entre `AppBusEventMap` de camera o de app-services.
 *
 * Las líneas con @ts-expect-error solo compilan; si algún día dejan de fallar,
 * tsc avisará de la directiva sobrante y el defecto estará resuelto.
 */
describe('review-simplicidad: EventBus no acepta los mapas del contrato tal cual', () => {
  it('tipado: EventBus<AppEventMap>, EventBus<MatchBusEventMap> y EventBus<CameraEventMap> no compilan', () => {
    const rejectedByCompiler = () => {
      // @ts-expect-error AppEventMap (intersección de interfaces) no satisface Record<string, unknown>
      const app: EventBus<AppEventMap> = createEventBus<AppEventMap>();
      // @ts-expect-error MatchBusEventMap (interface) no satisface Record<string, unknown>
      const match: EventBus<MatchBusEventMap> = createEventBus<MatchBusEventMap>();
      // @ts-expect-error CameraEventMap (interface) no satisface Record<string, unknown>
      const camera: EventBus<CameraEventMap> = createEventBus<CameraEventMap>();
      return [app, match, camera];
    };
    expect(typeof rejectedByCompiler).toBe('function');
  });

  it('el mismo mapa como tipo mapeado sí compila: la restricción es sintáctica, no semántica', () => {
    type Mapped = { [K in keyof AppEventMap]: AppEventMap[K] };
    const bus = createEventBus<Mapped>();
    const seen: number[] = [];
    bus.on('match.started', ({ period }) => seen.push(period));
    bus.emit('match.started', { matchId: 'm', timestamp: 1, period: 1 });
    expect(seen).toEqual([1]);
  });
});
