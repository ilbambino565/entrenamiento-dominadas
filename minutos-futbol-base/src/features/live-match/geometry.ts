import type { FieldPosition } from '../../core';

/**
 * Geometría pura de la pantalla de partido: medidas de la ficha y cómo se
 * traduce una posición normalizada (0..1) a un punto del campo. Vive aparte
 * para que `resolveDrop` y el dibujo del campo usen EXACTAMENTE la misma
 * regla: si no, el imán apuntaría a un sitio distinto del que se ve.
 */
export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

export const TOKEN_SIZE = 64;
export const TOKEN_RADIUS = TOKEN_SIZE / 2;
/**
 * Columna completa de la ficha: círculo (con dorsal y tiempo dentro) + pastilla
 * del nombre. Baja (84 dp) a propósito: en un móvil de 390 de ancho las filas
 * de una alineación distan ~100 dp y una columna más alta pisa la fila de abajo.
 */
export const TOKEN_COLUMN_WIDTH = 84;
export const TOKEN_COLUMN_HEIGHT = 84;
/** Alto de la pastilla del nombre bajo el círculo (la suma con el círculo da la columna). */
export const TOKEN_NAME_HEIGHT = TOKEN_COLUMN_HEIGHT - TOKEN_SIZE - 2;
/** Ancho / alto del campo vertical. */
export const PITCH_ASPECT = 0.68;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Centro del círculo de una ficha en el campo, en coordenadas locales del
 * campo. Se acota para que la columna entera (incluidos los textos de abajo)
 * quede dentro del rectángulo verde.
 */
export function fieldTokenCenter(position: FieldPosition, pitch: Size): Point {
  const maxY = Math.max(TOKEN_RADIUS, pitch.height - (TOKEN_COLUMN_HEIGHT - TOKEN_RADIUS));
  return {
    x: clamp(position.x * pitch.width, TOKEN_RADIUS, Math.max(TOKEN_RADIUS, pitch.width - TOKEN_RADIUS)),
    y: clamp(position.y * pitch.height, TOKEN_RADIUS, maxY),
  };
}

/** Mayor campo con la proporción fija que cabe en el hueco disponible. */
export function fitPitch(available: Size): Size {
  const height = Math.max(0, Math.min(available.height, available.width / PITCH_ASPECT));
  return { width: Math.round(height * PITCH_ASPECT), height: Math.round(height) };
}
