import { clampZoom } from './settings';
import { cloneCameraStatus } from './status';
import { CameraError, type CameraController, type CameraPosition, type CameraStatus } from './types';

/**
 * Controlador de cámara simulado.
 *
 * Sirve para desarrollar y probar el servicio, el panel y la automatización sin
 * hardware: respeta exactamente el contrato `CameraController` (transiciones,
 * errores, notificaciones) y añade ayudas de desarrollo para provocar fallos y
 * ver qué órdenes ha recibido.
 */

export interface DummyCameraControllerOptions {
  /** Reloj inyectable (epoch ms). Por defecto `Date.now`. */
  now?: () => number;
  /** Retardo simulado de `connect`. 0 = resuelve en el mismo tick. */
  latencyMs?: number;
  initialPosition?: CameraPosition;
  /** Incremento de zoomIn/zoomOut (0..1). Por defecto 0.1. */
  zoomStep?: number;
}

export interface DummyCameraController extends CameraController {
  /** Simula un fallo del dispositivo: `connection` 'error' y `error` = mensaje. */
  simulateError(message: string): void;
  /** Simula una pérdida de conexión no pedida por la app. */
  simulateDisconnect(): void;
  /** Operaciones del contrato invocadas, en orden (para tests). */
  getHistory(): string[];
  /** Vuelve al estado inicial y vacía el historial. Conserva los suscriptores. */
  reset(): void;
}

export function createDummyCameraController(
  options: DummyCameraControllerOptions = {},
): DummyCameraController {
  const now = options.now ?? (() => Date.now());
  const latencyMs = Math.max(0, options.latencyMs ?? 0);
  const zoomStep = Number.isFinite(options.zoomStep) ? (options.zoomStep as number) : 0.1;

  const listeners = new Set<(status: CameraStatus) => void>();
  const history: string[] = [];

  function initialStatus(): CameraStatus {
    const initial = options.initialPosition;
    const zoom = clampZoom(initial?.zoom ?? 0);
    return {
      connection: 'disconnected',
      recording: 'idle',
      // zone y recordingId los gestiona el servicio; el hardware no los conoce.
      recordingId: null,
      zone: null,
      position: initial ? { pan: initial.pan, tilt: initial.tilt, zoom } : null,
      zoom,
      panning: null,
      error: null,
      updatedAt: now(),
    };
  }

  let status = initialStatus();

  function setStatus(next: CameraStatus): void {
    status = { ...next, updatedAt: now() };
    // Copia por suscriptor: ninguno puede alterar lo que ve otro.
    for (const listener of Array.from(listeners)) listener(cloneCameraStatus(status));
  }

  function update(patch: Partial<CameraStatus>): void {
    setStatus({ ...status, ...patch });
  }

  function requireConnected(): void {
    if (status.connection !== 'connected') {
      throw new CameraError('NOT_CONNECTED', 'La cámara no está conectada');
    }
  }

  function requireNotConnected(): void {
    if (status.connection === 'connected' || status.connection === 'connecting') {
      throw new CameraError('ALREADY_CONNECTED', 'La cámara ya está conectada');
    }
  }

  /** `status.zoom` es la verdad; `position.zoom` la refleja para no dar dos valores distintos. */
  function applyZoom(value: number): void {
    // Redondeo a milésimas: evita arrastrar 0.30000000000000004 hasta la pantalla.
    const zoom = clampZoom(Math.round(value * 1000) / 1000);
    update({ zoom, position: status.position ? { ...status.position, zoom } : null });
  }

  const controller: DummyCameraController = {
    deviceType: 'dummy',

    async connect() {
      history.push('connect');
      requireNotConnected();
      update({ connection: 'connecting', error: null });
      if (latencyMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
      // Si durante la espera alguien desconectó, no resucitamos la conexión.
      if (status.connection !== 'connecting') return;
      update({ connection: 'connected' });
    },

    async disconnect() {
      history.push('disconnect');
      // Desconectar con una grabación en curso la para sin protestar: es lo que
      // haría el hardware al perder la conexión.
      update({ connection: 'disconnected', recording: 'idle', panning: null, error: null });
    },

    async startRecording() {
      history.push('startRecording');
      requireConnected();
      if (status.recording !== 'idle') {
        throw new CameraError('ALREADY_RECORDING', 'Ya hay una grabación en curso');
      }
      update({ recording: 'recording' });
    },

    async pauseRecording() {
      history.push('pauseRecording');
      requireConnected();
      if (status.recording !== 'recording') {
        throw new CameraError('NOT_RECORDING', 'No hay ninguna grabación que pausar');
      }
      update({ recording: 'paused' });
    },

    async resumeRecording() {
      history.push('resumeRecording');
      requireConnected();
      if (status.recording !== 'paused') {
        throw new CameraError('NOT_RECORDING', 'No hay ninguna grabación pausada');
      }
      update({ recording: 'recording' });
    },

    async stopRecording() {
      history.push('stopRecording');
      requireConnected();
      if (status.recording === 'idle') {
        throw new CameraError('NOT_RECORDING', 'No hay ninguna grabación que parar');
      }
      update({ recording: 'idle' });
    },

    async panLeft() {
      history.push('panLeft');
      requireConnected();
      update({ panning: 'left' });
    },

    async panRight() {
      history.push('panRight');
      requireConnected();
      update({ panning: 'right' });
    },

    async stopPan() {
      history.push('stopPan');
      requireConnected();
      update({ panning: null });
    },

    async recenter() {
      history.push('recenter');
      requireConnected();
      update({ position: { pan: 0, tilt: 0, zoom: status.zoom }, panning: null });
    },

    async goToPosition(position, transitionMs) {
      // El dummy no anima: solo deja constancia de la transición pedida.
      history.push(`goToPosition(${position.pan},${position.tilt},${transitionMs ?? 0})`);
      requireConnected();
      const zoom = clampZoom(position.zoom ?? status.zoom);
      update({ position: { pan: position.pan, tilt: position.tilt, zoom }, zoom, panning: null });
    },

    async zoomIn() {
      history.push('zoomIn');
      requireConnected();
      applyZoom(status.zoom + zoomStep);
    },

    async zoomOut() {
      history.push('zoomOut');
      requireConnected();
      applyZoom(status.zoom - zoomStep);
    },

    async setZoom(value) {
      history.push(`setZoom(${value})`);
      requireConnected();
      if (!Number.isFinite(value)) {
        throw new CameraError('UNSUPPORTED', `Valor de zoom no válido: ${value}`);
      }
      applyZoom(value);
    },

    getStatus() {
      return cloneCameraStatus(status);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    simulateError(message) {
      // Con el dispositivo en error no sabemos si sigue grabando: lo damos por parado.
      update({ connection: 'error', recording: 'idle', panning: null, error: message });
    },

    simulateDisconnect() {
      update({ connection: 'disconnected', recording: 'idle', panning: null, error: null });
    },

    getHistory() {
      return [...history];
    },

    reset() {
      history.length = 0;
      setStatus(initialStatus());
    },
  };

  return controller;
}
