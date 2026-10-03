import type { EventBus } from '../events/bus';
import { uuidv7 } from '../lib/uuid';
import type { CameraStore } from './cameraStore';
import { normalizeCameraSettings } from './settings';
import { INITIAL_CAMERA_STATUS, cloneCameraStatus } from './status';
import {
  CameraError,
  type CameraCapabilities,
  type CameraController,
  type CameraErrorCode,
  type CameraEventMap,
  type CameraSettings,
  type CameraStatus,
  type CameraZone,
} from './types';

/**
 * Casos de uso de la cámara.
 *
 * Es la única pieza que habla con el `CameraController`. Refleja su estado en
 * el store, añade lo que el hardware no sabe (zona activa, id de grabación) y
 * publica `camera.*` en el bus para que la timeline del partido lo registre.
 *
 * Contrato con la UI: ninguna operación lanza. Devuelve `true` si se ejecutó y
 * `false` si no procedía (modo external, sin controlador, capacidad ausente,
 * zoom deshabilitado) o si falló; los fallos quedan en `status.error` y se
 * publican como `camera.error`. Así la pantalla del partido nunca se bloquea
 * por la cámara.
 */

export interface CameraServiceDeps {
  bus: EventBus<CameraEventMap>;
  store: CameraStore;
  controller?: CameraController;
  /** Reloj inyectable (epoch ms). Por defecto `Date.now`. */
  now?: () => number;
  /** Generador del `recordingId`. Por defecto UUIDv7 con `now`. */
  newId?: () => string;
}

export interface CameraService {
  /** Sustituye la configuración del partido (null/undefined = valores por defecto). */
  configure(settings?: Partial<CameraSettings> | null): void;
  getSettings(): CameraSettings;
  getStatus(): CameraStatus;
  /** Capacidades del controlador adjunto; null si no hay ninguno. */
  getCapabilities(): CameraCapabilities | null;

  /** Adjunta (o sustituye) el controlador. No desconecta el anterior: usa detachController. */
  attachController(controller: CameraController): void;
  /** Desconecta si hacía falta y suelta el controlador. */
  detachController(): Promise<void>;

  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;

  startRecording(): Promise<boolean>;
  pauseRecording(): Promise<boolean>;
  resumeRecording(): Promise<boolean>;
  stopRecording(): Promise<boolean>;

  goToZone(zone: CameraZone): Promise<boolean>;
  recenter(): Promise<boolean>;
  panLeft(): Promise<boolean>;
  panRight(): Promise<boolean>;
  stopPan(): Promise<boolean>;

  zoomIn(): Promise<boolean>;
  zoomOut(): Promise<boolean>;
  setZoom(value: number): Promise<boolean>;

  /** Suelta el controlador y deja el servicio inerte (toda operación → false). */
  dispose(): Promise<void>;
}

function errorCode(error: unknown): CameraErrorCode | null {
  return error instanceof CameraError ? error.code : null;
}

/** Texto para `status.error`: con el código delante para poder filtrarlo a simple vista. */
function describeError(error: unknown): string {
  if (error instanceof CameraError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createCameraService(deps: CameraServiceDeps): CameraService {
  const { bus, store } = deps;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => uuidv7(now()));

  let controller: CameraController | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  const current = (): CameraStatus => store.getState().status;

  /** Único punto de escritura del estado: aquí se detecta el cambio de conexión. */
  function applyStatus(next: CameraStatus): void {
    const previous = current();
    store.setStatus(next);
    if (next.connection !== previous.connection) {
      bus.emit('camera.connection.changed', { status: cloneCameraStatus(next), timestamp: now() });
    }
  }

  function patch(partial: Partial<CameraStatus>): void {
    applyStatus({ ...current(), ...partial, updatedAt: now() });
  }

  function fail(error: unknown): false {
    const message = describeError(error);
    patch({ error: message });
    bus.emit('camera.error', { code: errorCode(error), message, timestamp: now() });
    return false;
  }

  /** Controlador al que se puede mandar órdenes, o null (modo external, sin controlador, liberado). */
  function ready(): CameraController | null {
    if (disposed || !controller || !store.getState().available) return null;
    return controller;
  }

  /**
   * Controlador listo Y con la capacidad pedida. Una capacidad ausente no es
   * un error: la UI no debería ofrecerla (igual que el zoom deshabilitado).
   */
  function readyFor(capability: keyof CameraCapabilities): CameraController | null {
    const target = ready();
    return target && target.capabilities[capability] ? target : null;
  }

  async function run(
    capability: keyof CameraCapabilities | null,
    operation: (controller: CameraController) => Promise<void>,
  ): Promise<boolean> {
    const target = capability ? readyFor(capability) : ready();
    if (!target) return false;
    try {
      await operation(target);
      return true;
    } catch (error) {
      return fail(error);
    }
  }

  /**
   * El controlador solo conoce el hardware: se conserva lo que gestiona el
   * servicio (zona, id de grabación). Si la conexión se pierde con una
   * grabación en curso, la damos por terminada para que la timeline la cierre.
   */
  function onControllerStatus(incoming: CameraStatus): void {
    const previous = current();
    const connectionLost = previous.connection === 'connected' && incoming.connection !== 'connected';
    const lostRecordingId = connectionLost ? previous.recordingId : null;

    applyStatus({
      ...incoming,
      zone: previous.zone,
      recordingId: lostRecordingId !== null ? null : previous.recordingId,
      recording: lostRecordingId !== null ? 'idle' : incoming.recording,
      updatedAt: now(),
    });

    if (incoming.error !== null && incoming.error !== previous.error) {
      bus.emit('camera.error', { code: 'DEVICE_ERROR', message: incoming.error, timestamp: now() });
    }
    if (lostRecordingId !== null) {
      bus.emit('camera.record.stopped', { recordingId: lostRecordingId, timestamp: now() });
    }
  }

  function attachController(next: CameraController): void {
    if (disposed) return;
    unsubscribe?.();
    controller = next;
    store.setControllerAttached(true, next.capabilities);
    onControllerStatus(next.getStatus());
    unsubscribe = next.subscribe(onControllerStatus);
  }

  async function detachController(): Promise<void> {
    const target = controller;
    if (!target) return;
    const { connection } = target.getStatus();
    if (connection === 'connected' || connection === 'connecting') {
      try {
        // La desconexión llega por el listener: publica connection.changed y,
        // si grababa, record.stopped.
        await target.disconnect();
      } catch (error) {
        fail(error);
      }
    }
    unsubscribe?.();
    unsubscribe = undefined;
    controller = undefined;
    store.setControllerAttached(false, null);
    applyStatus({ ...INITIAL_CAMERA_STATUS, updatedAt: now() });
  }

  /** Operación de movimiento: la cámara deja de apuntar a la zona calibrada. */
  async function move(operation: (controller: CameraController) => Promise<void>): Promise<boolean> {
    const ok = await run('pan', operation);
    if (ok) patch({ zone: null });
    return ok;
  }

  async function zoom(operation: (controller: CameraController) => Promise<void>): Promise<boolean> {
    // Zoom deshabilitado no es un error: la UI simplemente no debería ofrecerlo.
    if (!store.getState().settings.zoomEnabled) return false;
    return run('zoom', operation);
  }

  if (deps.controller) attachController(deps.controller);

  return {
    configure(settings) {
      store.setSettings(normalizeCameraSettings(settings));
    },

    getSettings: () => store.getState().settings,
    getStatus: () => cloneCameraStatus(current()),
    getCapabilities: () => (controller ? { ...controller.capabilities } : null),

    attachController,
    detachController,

    connect: () => run(null, (c) => c.connect()),
    disconnect: () => run(null, (c) => c.disconnect()),

    async startRecording() {
      const ok = await run('record', (c) => c.startRecording());
      if (!ok) return false;
      const recordingId = newId();
      patch({ recordingId });
      bus.emit('camera.record.started', {
        recordingId,
        deviceType: controller?.deviceType ?? null,
        timestamp: now(),
      });
      return true;
    },

    async pauseRecording() {
      // Sin recordingId el servicio no inició ninguna grabación: nada que publicar.
      const recordingId = current().recordingId;
      if (recordingId === null) return false;
      const ok = await run('pause', (c) => c.pauseRecording());
      if (ok) bus.emit('camera.record.paused', { recordingId, timestamp: now() });
      return ok;
    },

    async resumeRecording() {
      const recordingId = current().recordingId;
      if (recordingId === null) return false;
      const ok = await run('pause', (c) => c.resumeRecording());
      if (ok) bus.emit('camera.record.resumed', { recordingId, timestamp: now() });
      return ok;
    },

    async stopRecording() {
      const recordingId = current().recordingId;
      if (recordingId === null) return false;
      const ok = await run('record', (c) => c.stopRecording());
      if (!ok) return false;
      patch({ recordingId: null });
      bus.emit('camera.record.stopped', { recordingId, timestamp: now() });
      return true;
    },

    async goToZone(zone) {
      if (!readyFor('pan')) return false;
      const { zones, smoothTransitionMs } = store.getState().settings;
      const position = zones[zone];
      if (!position) {
        return fail(new CameraError('ZONE_NOT_CALIBRATED', `La zona ${zone} no está calibrada`));
      }
      const previousZone = current().zone;
      const ok = await run('pan', (c) => c.goToPosition(position, smoothTransitionMs));
      if (!ok) return false;
      patch({ zone });
      bus.emit('camera.zone.changed', { zone, previousZone, timestamp: now() });
      return true;
    },

    recenter: () => move((c) => c.recenter()),
    panLeft: () => move((c) => c.panLeft()),
    panRight: () => move((c) => c.panRight()),
    stopPan: () => run('pan', (c) => c.stopPan()),

    zoomIn: () => zoom((c) => c.zoomIn()),
    zoomOut: () => zoom((c) => c.zoomOut()),
    setZoom: (value) => zoom((c) => c.setZoom(value)),

    async dispose() {
      await detachController();
      disposed = true;
    },
  };
}
