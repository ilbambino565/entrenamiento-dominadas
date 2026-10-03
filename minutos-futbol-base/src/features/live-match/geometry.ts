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

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Medidas de referencia de la ficha (escala 1). */
export const TOKEN_SIZE = 64;
export const TOKEN_RADIUS = TOKEN_SIZE / 2;
/**
 * Columna completa de la ficha: círculo (con dorsal y tiempo dentro) + pastilla
 * del nombre. Baja (84 dp) a propósito: en un móvil las filas de una alineación
 * distan ~100 dp y una columna más alta pisa la fila de abajo.
 */
export const TOKEN_COLUMN_WIDTH = 84;
export const TOKEN_COLUMN_HEIGHT = 84;
/** Alto de la pastilla del nombre bajo el círculo (la suma con el círculo da la columna). */
export const TOKEN_NAME_HEIGHT = TOKEN_COLUMN_HEIGHT - TOKEN_SIZE - 2;
/** Separación mínima entre la columna de una ficha y el borde del campo. */
export const PITCH_INSET = 4;

/** Medidas de una ficha a una escala dada (1 = las de referencia de arriba). */
export interface TokenMetrics {
  scale: number;
  size: number;
  radius: number;
  columnWidth: number;
  columnHeight: number;
  nameHeight: number;
  numberFont: number;
  timeFont: number;
  nameFont: number;
}

/** Escala mínima: 46 dp de círculo, por encima de los 44 dp tocables de pie y al sol (docs/05 §5.4). */
export const MIN_TOKEN_SCALE = 0.72;
/** Banquillo en pantallas estrechas: 52 dp, cinco suplentes caben en una fila de 390 dp. */
export const COMPACT_TOKEN_SCALE = 0.8125;

export function tokenMetrics(scale = 1): TokenMetrics {
  const s = clamp(scale, MIN_TOKEN_SCALE, 1);
  const size = Math.round(TOKEN_SIZE * s);
  const nameHeight = Math.max(14, Math.round(TOKEN_NAME_HEIGHT * s));
  return {
    scale: s,
    size,
    radius: size / 2,
    columnWidth: Math.round(TOKEN_COLUMN_WIDTH * s),
    columnHeight: size + 2 + nameHeight,
    nameHeight,
    numberFont: Math.ceil(20 * s),
    timeFont: Math.ceil(14 * s),
    nameFont: Math.max(11, Math.round(12 * s)),
  };
}

export const FULL_TOKEN: TokenMetrics = tokenMetrics(1);
export const COMPACT_TOKEN: TokenMetrics = tokenMetrics(COMPACT_TOKEN_SCALE);

/**
 * Ancho / alto del campo vertical. Proporción "de verdad" (0,68) cuando sobra
 * alto; si el hueco es bajo (móvil con el banquillo en dos filas, visor con
 * cabecera), el campo se ensancha hasta 0,9 para no encoger las fichas: en
 * fútbol base la forma exacta del rectángulo importa menos que que se pueda
 * tocar cada ficha sin pisar la de al lado.
 */
export const PITCH_ASPECT = 0.68;
export const PITCH_ASPECT_MAX = 0.9;
/** Por debajo de este ancho de ventana la pantalla usa las variantes compactas. */
export const NARROW_SCREEN_WIDTH = 600;
/**
 * Alto de campo a partir del cual la ficha de referencia cabe sin pisar a
 * nadie con cualquier dibujo de F7 (defensa en 0,7 de alto y portero acotado
 * al borde: 0,3 × alto ≥ dos columnas menos un radio). Por debajo, la ficha del
 * campo se encoge en proporción hasta MIN_TOKEN_SCALE (campo de ~350 dp).
 */
export const FULL_TOKEN_PITCH_HEIGHT = 490;

export function fieldTokenScale(pitch: Size): number {
  if (pitch.height <= 0) return 1;
  return clamp(pitch.height / FULL_TOKEN_PITCH_HEIGHT, MIN_TOKEN_SCALE, 1);
}

/** Medidas de las fichas del campo para un campo dado. El imán usa las mismas. */
export function fieldTokenMetrics(pitch: Size): TokenMetrics {
  return tokenMetrics(fieldTokenScale(pitch));
}

/**
 * Centro del círculo de una ficha en el campo, en coordenadas locales del
 * campo. Se acota para que la columna entera (incluida la pastilla del nombre)
 * quede dentro del rectángulo verde con PITCH_INSET de margen.
 */
export function fieldTokenCenter(position: FieldPosition, pitch: Size, m: TokenMetrics = fieldTokenMetrics(pitch)): Point {
  const minY = m.radius + PITCH_INSET;
  const maxY = Math.max(minY, pitch.height - (m.columnHeight - m.radius) - PITCH_INSET);
  return {
    x: clamp(position.x * pitch.width, m.radius, Math.max(m.radius, pitch.width - m.radius)),
    y: clamp(position.y * pitch.height, minY, maxY),
  };
}

/**
 * Mayor campo que cabe en el hueco con una proporción entre PITCH_ASPECT y
 * PITCH_ASPECT_MAX: con alto de sobra sale el campo "real"; con poco alto se
 * ensancha hasta ocupar el ancho disponible.
 */
export function fitPitch(available: Size): Size {
  if (available.width <= 0 || available.height <= 0) return { width: 0, height: 0 };
  const aspect = clamp(available.width / available.height, PITCH_ASPECT, PITCH_ASPECT_MAX);
  const height = Math.min(available.height, available.width / aspect);
  return { width: Math.round(height * aspect), height: Math.round(height) };
}
