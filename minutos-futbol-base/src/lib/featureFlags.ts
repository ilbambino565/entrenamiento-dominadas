/**
 * Interruptores de funcionalidad. Todo lo que no forma parte del flujo
 * principal del MVP (jugadores, tiempos, cambios, cronómetro) nace apagado.
 */
export const FEATURE_FLAGS = Object.freeze({
  /** Panel de control de cámara (zonas, REC, zoom). Futuro: modo `zones`. */
  cameraPanel: false,
  /** Distintivo "CAMERA ● EXTERNAL" en la pantalla de partido. */
  cameraStatusBadge: false,
});

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
