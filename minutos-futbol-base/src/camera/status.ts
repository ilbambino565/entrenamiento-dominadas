import type { CameraStatus } from './types';

/** Estado antes de adjuntar o conectar nada. `updatedAt` 0 = nunca actualizado. */
export const INITIAL_CAMERA_STATUS: CameraStatus = Object.freeze({
  connection: 'disconnected',
  recording: 'idle',
  recordingId: null,
  zone: null,
  position: null,
  zoom: 0,
  panning: null,
  error: null,
  updatedAt: 0,
});

/**
 * Copia independiente. El controlador, el servicio y el store comparten
 * instantáneas del estado; ninguno debe poder mutar la del otro.
 */
export function cloneCameraStatus(status: CameraStatus): CameraStatus {
  return { ...status, position: status.position ? { ...status.position } : null };
}
