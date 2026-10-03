import type { FieldPosition, MatchState, PlayerLocation } from '../../core';
import { clamp, fieldTokenCenter, fieldTokenMetrics, type Point, type Rect, type Size } from './geometry';

/**
 * Qué significa soltar (o tocar) en un sitio. Función PURA (docs/04 §4.4):
 * recibe el origen, el punto absoluto, las medidas de las zonas y el estado,
 * y devuelve la acción. Nada de aquí toca el motor ni React.
 */
export interface DropOrigin {
  playerId: string;
  from: PlayerLocation;
}

export interface TokenLayout {
  playerId: string;
  center: Point;
  radius: number;
}

export interface DropLayout {
  pitch: Rect | null;
  bench: Rect | null;
  /** Fichas del campo con su centro absoluto (las del banquillo no son destino). */
  tokens: TokenLayout[];
}

export type DropAction =
  | { kind: 'substitute'; inId: string; outId: string }
  | { kind: 'swap'; a: string; b: string }
  | { kind: 'enter'; playerId: string; position: FieldPosition }
  | { kind: 'move'; playerId: string; position: FieldPosition }
  | { kind: 'leave'; playerId: string }
  | { kind: 'reorder-bench' }
  | { kind: 'cancel' }
  | { kind: 'rejected'; reason: 'FIELD_FULL' | 'SAME_PLAYER' };

/** Destino ya localizado: lo que el gesto "señala" antes de decidir la acción. */
export type DropTarget =
  | { kind: 'token'; playerId: string }
  | { kind: 'pitch'; position: FieldPosition }
  | { kind: 'bench' }
  | { kind: 'none' };

export interface ResolveDropInput {
  origin: DropOrigin;
  point: Point;
  layout: DropLayout;
  state: MatchState;
}

/** Franja muerta entre zonas (docs/04 §4.3 nº 6). */
export const DEAD_ZONE = 12;
/** Radio del imán: 0,6 × diámetro de la ficha. */
export const MAGNET_FACTOR = 0.6;
export const POSITION_MIN = 0.04;
export const POSITION_MAX = 0.96;

const insideInset = (rect: Rect, p: Point, inset: number): boolean =>
  p.x >= rect.x + inset && p.x <= rect.x + rect.width - inset && p.y >= rect.y + inset && p.y <= rect.y + rect.height - inset;

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalizePosition(point: Point, pitch: Rect): FieldPosition {
  return {
    x: clamp((point.x - pitch.x) / Math.max(1, pitch.width), POSITION_MIN, POSITION_MAX),
    y: clamp((point.y - pitch.y) / Math.max(1, pitch.height), POSITION_MIN, POSITION_MAX),
  };
}

/**
 * Dónde cae el punto: ficha (imán), campo libre, banquillo o nada.
 * `excludeId` saca del imán a la ficha que se está arrastrando: su centro
 * sigue en el sitio de origen y, si no, recolocarla unos píxeles la "atraería"
 * a sí misma en vez de moverla (docs/04 §4.1: campo → zona vacía = recolocar).
 */
export function locateTarget(point: Point, layout: DropLayout, excludeId?: string): DropTarget {
  let nearest: TokenLayout | null = null;
  let best = Infinity;
  for (const token of layout.tokens) {
    if (token.playerId === excludeId) continue;
    const d = distance(point, token.center);
    if (d < MAGNET_FACTOR * 2 * token.radius && d < best) {
      best = d;
      nearest = token;
    }
  }
  if (nearest) return { kind: 'token', playerId: nearest.playerId };
  if (layout.pitch && insideInset(layout.pitch, point, DEAD_ZONE)) {
    return { kind: 'pitch', position: normalizePosition(point, layout.pitch) };
  }
  if (layout.bench && insideInset(layout.bench, point, DEAD_ZONE)) return { kind: 'bench' };
  return { kind: 'none' };
}

const fieldCount = (state: MatchState): number =>
  Object.values(state.players).filter((p) => p.location === 'FIELD').length;

/** Acción para un destino ya localizado. La usa también la selección por toques. */
export function resolveTarget(origin: DropOrigin, target: DropTarget, state: MatchState): DropAction {
  switch (target.kind) {
    case 'token': {
      if (target.playerId === origin.playerId) return { kind: 'rejected', reason: 'SAME_PLAYER' };
      const other = state.players[target.playerId];
      if (!other) return { kind: 'cancel' };
      if (other.location === 'BENCH') {
        // Tocar una ficha del banquillo equivale a soltar en el banquillo.
        return origin.from === 'FIELD' ? { kind: 'leave', playerId: origin.playerId } : { kind: 'reorder-bench' };
      }
      return origin.from === 'BENCH'
        ? { kind: 'substitute', inId: origin.playerId, outId: target.playerId }
        : { kind: 'swap', a: origin.playerId, b: target.playerId };
    }
    case 'pitch':
      if (origin.from === 'FIELD') return { kind: 'move', playerId: origin.playerId, position: target.position };
      if (fieldCount(state) >= state.config.playersOnField) return { kind: 'rejected', reason: 'FIELD_FULL' };
      return { kind: 'enter', playerId: origin.playerId, position: target.position };
    case 'bench':
      return origin.from === 'FIELD' ? { kind: 'leave', playerId: origin.playerId } : { kind: 'reorder-bench' };
    case 'none':
      return { kind: 'cancel' };
  }
}

export function resolveDrop(input: ResolveDropInput): DropAction {
  return resolveTarget(input.origin, locateTarget(input.point, input.layout, input.origin.playerId), input.state);
}

/**
 * Fichas del campo con centro absoluto, derivadas del estado y del rectángulo
 * del campo. Mismas medidas que pinta `Pitch` (escaladas con el alto del campo).
 */
export function fieldTokenLayouts(state: MatchState, pitch: Rect | null): TokenLayout[] {
  if (!pitch) return [];
  const size: Size = { width: pitch.width, height: pitch.height };
  const m = fieldTokenMetrics(size);
  const out: TokenLayout[] = [];
  for (const p of Object.values(state.players)) {
    if (p.location !== 'FIELD' || !p.position) continue;
    const local = fieldTokenCenter(p.position, size, m);
    out.push({ playerId: p.playerId, center: { x: pitch.x + local.x, y: pitch.y + local.y }, radius: m.radius });
  }
  return out;
}
