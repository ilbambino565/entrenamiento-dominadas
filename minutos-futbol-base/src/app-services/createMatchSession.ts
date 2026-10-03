import {
  createCameraService,
  createCameraStore,
  normalizeCameraSettings,
  type CameraController,
  type CameraService,
  type CameraSettings,
  type CameraStore,
} from '../camera';
import type { MatchConfig } from '../core';
import type { EventStore } from '../db/eventStore';
import { createEventBus } from '../events/bus';
import type { AppEventMap } from '../events/topics';
import { createCameraTimelineBridge } from './cameraTimelineBridge';
import { createMatchEngine, type AppBus, type MatchEngine } from './matchEngine';

/**
 * Raíz de composición de un partido: motor + bus + cámara + puente.
 *
 * `cameraSettings` es opcional en todas partes. Sin ella (el MVP) la cámara
 * queda en modo `external` y deshabilitada: no se manda ninguna orden al
 * hardware y toda operación del servicio devuelve `false`. El motor funciona
 * exactamente igual con o sin cámara.
 */
export interface MatchSessionDeps {
  config: MatchConfig;
  store: EventStore;
  cameraSettings?: Partial<CameraSettings> | null;
  /** Solo se adjunta si se pasa; nadie lo crea aquí (en el MVP no hay dispositivo). */
  cameraController?: CameraController;
  now?: () => number;
  newId?: () => string;
  /** Bus compartido con otras partes de la app; si no se pasa, se crea uno propio. */
  bus?: AppBus;
}

export interface MatchSession {
  engine: MatchEngine;
  bus: AppBus;
  camera: CameraService;
  cameraStore: CameraStore;
  /**
   * Libera la cámara y después desuscribe el puente. En ese orden: si había
   * una grabación en curso, al soltar la cámara se publica `record.stopped`
   * y la timeline registra su cierre antes de que el puente deje de escuchar.
   */
  dispose(): Promise<void>;
}

export function createMatchSession(deps: MatchSessionDeps): MatchSession {
  const { config, store, now, newId } = deps;
  const bus: AppBus = deps.bus ?? createEventBus<AppEventMap>();

  const engine = createMatchEngine({ config, store, bus, now, newId });

  // Normalizar aunque no venga: así el store nace con valores por defecto
  // completos y la UI nunca ve `undefined`.
  const cameraStore = createCameraStore(normalizeCameraSettings(deps.cameraSettings));
  const camera = createCameraService({ bus, store: cameraStore, controller: deps.cameraController, now, newId });

  const unbridge = createCameraTimelineBridge(bus, engine);

  // `createCameraAutomation` (match.started → startRecording, etc.) NO se
  // registra: `autoRecord` es siempre false en el MVP y la cámara se maneja
  // desde fuera de la app. El día que se active bastará con llamarla aquí
  // cuando `cameraStore.getState().settings.autoRecord` sea true.

  return {
    engine,
    bus,
    camera,
    cameraStore,
    async dispose() {
      await camera.dispose();
      unbridge();
    },
  };
}
