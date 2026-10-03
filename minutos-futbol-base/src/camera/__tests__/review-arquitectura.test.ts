import { createEventBus, type EventBus } from '../../events/bus';
import type { MatchBusEventMap } from '../../events/topics';
import { createCameraAutomation } from '../automation';
import { createCameraService, type CameraBusEventMap, type CameraService } from '../cameraService';
import { createCameraStore } from '../cameraStore';
import { createDummyCameraController } from '../dummyCameraController';
import { INITIAL_CAMERA_STATUS } from '../status';
import { CameraError, type CameraController } from '../types';

/**
 * REVISIÓN (arquitectura y desacoplamiento). Evidencia de dos acoplamientos:
 * - el contrato `CameraController` no tiene capacidades opcionales ni documenta
 *   la convención UNSUPPORTED, así que un gimbal (DJI RSC 2) o una cámara sin
 *   pan (Sony A6600) solo pueden fallar DESPUÉS de que el usuario pulse;
 * - `createCameraAutomation` exige un bus tipado con TODO `AppEventMap`
 *   (incluido `MatchEvent` de core), no solo con los cuatro temas del reloj.
 */

describe('review-arquitectura: CameraController frente a dispositivos reales', () => {
  it('tipado: un controlador solo-gimbal no puede omitir grabación ni zoom (no hay capacidades opcionales)', () => {
    const noop = async () => undefined;
    const gimbalOnly = {
      deviceType: 'dji_rsc2' as const,
      connect: noop,
      disconnect: noop,
      panLeft: noop,
      panRight: noop,
      stopPan: noop,
      recenter: noop,
      goToPosition: noop,
      getStatus: () => INITIAL_CAMERA_STATUS,
      subscribe: () => () => undefined,
    };
    // @ts-expect-error faltan startRecording/pauseRecording/resumeRecording/stopRecording/zoomIn/zoomOut/setZoom
    const asController: CameraController = gimbalOnly;
    expect(asController.deviceType).toBe('dji_rsc2');
  });

  it('REC en un gimbal: nada permite saberlo antes de pulsar; el servicio lo trata como fallo genérico', async () => {
    const dummy = createDummyCameraController({ now: () => 1 });
    const gimbal: CameraController = {
      ...dummy,
      deviceType: 'dji_rsc2',
      startRecording: async () => {
        throw new CameraError('UNSUPPORTED', 'El RSC 2 no graba');
      },
    };
    const bus = createEventBus<CameraBusEventMap>();
    const store = createCameraStore({ enabled: true, mode: 'zones', deviceType: 'dji_rsc2' });
    const service = createCameraService({ bus, store, controller: gimbal, now: () => 1 });
    const errors: string[] = [];
    bus.on('camera.error', ({ message }) => errors.push(message));

    await service.connect();
    // `available` es la única señal que tiene el panel para habilitar REC/PAUSA/STOP/RECENTER.
    expect(store.getState().available).toBe(true);
    expect(await service.startRecording()).toBe(false);
    expect(errors).toEqual(['UNSUPPORTED: El RSC 2 no graba']);
    expect(store.getState().status.error).toBe('UNSUPPORTED: El RSC 2 no graba');
  });
});

describe('review-arquitectura: fuga de tipos camera → core vía AppEventMap', () => {
  it('tipado: la automatización rechaza un bus que solo tenga los temas del reloj que usa', () => {
    type ClockTopic = 'match.started' | 'match.halftime' | 'match.period.started' | 'match.finished';
    type ClockMap = { [K in ClockTopic]: MatchBusEventMap[K] };
    const clockBus: EventBus<ClockMap> = createEventBus<ClockMap>();
    const service = {} as unknown as CameraService;

    // Solo compila, nunca se ejecuta: lo que importa es que tsc rechace la llamada.
    const rejectedByCompiler = () => {
      // @ts-expect-error EventBus<ClockMap> no es asignable a EventBus<AppBusEventMap>: exige 'match.event.recorded' { event: MatchEvent }
      createCameraAutomation(clockBus, service);
    };
    expect(typeof rejectedByCompiler).toBe('function');
  });
});
