import type { ClockSegment, MatchState, PlayerInterval } from './state';

/**
 * PlayerTimeTracker: toda la aritmética de minutos.
 *
 * Nada se cuenta; todo se calcula a partir de dos familias de tramos en tiempo
 * real (epoch ms): los `ClockSegment` (reloj del partido en marcha) y los
 * `PlayerInterval` (jugador en el campo). El tiempo jugado es la intersección
 * de ambos. Por eso una pausa o el descanso "congelan" a todos sin tocar sus
 * intervalos, y por eso reabrir la app tras minutos con el móvil bloqueado da
 * el valor correcto: solo hace falta un `now` fresco.
 *
 * `now` SIEMPRE se inyecta: estas funciones son puras y deterministas. Toda
 * duración pasa por `Math.max(0, …)` porque el reloj del sistema puede saltar
 * hacia atrás y un tramo guardado puede acabar "antes" de empezar.
 */

/** Tramo genérico. `end` null = abierto hasta `now`. */
export interface Span {
  start: number;
  end: number | null;
}

const closeAt = (end: number | null, now: number): number => end ?? now;

const spanMs = (span: Span, now: number): number => Math.max(0, closeAt(span.end, now) - span.start);

const segmentSpan = (s: ClockSegment): Span => ({ start: s.startedAt, end: s.endedAt });
const intervalSpan = (i: PlayerInterval): Span => ({ start: i.startedAt, end: i.endedAt });

/** Milisegundos en los que `a` y `b` coinciden. 0 si no se tocan. */
export function overlapMs(a: Span, b: Span, now: number): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(closeAt(a.end, now), closeAt(b.end, now));
  return Math.max(0, end - start);
}

/** Reloj acumulado de todo el partido (incluye el tiempo añadido). */
export function matchClockMs(segments: readonly ClockSegment[], now: number): number {
  let total = 0;
  for (const s of segments) total += spanMs(segmentSpan(s), now);
  return total;
}

/** Reloj acumulado de un solo periodo. */
export function periodClockMs(segments: readonly ClockSegment[], period: number, now: number): number {
  return matchClockMs(
    segments.filter((s) => s.period === period),
    now,
  );
}

function spansPlayedMs(spans: readonly Span[], segments: readonly ClockSegment[], now: number): number {
  let total = 0;
  for (const span of spans) {
    for (const s of segments) total += overlapMs(span, segmentSpan(s), now);
  }
  return total;
}

/** Tiempo de juego = Σ intervalos ∩ segmentos. Cuadrático, pero son ~6×6. */
export function playedMs(
  intervals: readonly PlayerInterval[],
  segments: readonly ClockSegment[],
  now: number,
): number {
  return spansPlayedMs(intervals.map(intervalSpan), segments, now);
}

/**
 * Une los tramos de UN jugador que se solapen o se toquen. Normalmente no se
 * solapan, pero si el reloj del sistema retrocede entre salir y volver a
 * entrar, el segundo tramo empieza "antes" de que acabara el primero y ese
 * trozo no debe contarse dos veces: nadie puede sumar más que el reloj.
 */
export function mergeSpans(spans: readonly Span[], now: number): Span[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of ordered) {
    const last = merged[merged.length - 1];
    if (last && span.start <= closeAt(last.end, now)) {
      // Un extremo abierto absorbe a cualquier otro; si no, se queda el mayor.
      if (last.end !== null) last.end = span.end === null ? null : Math.max(last.end, span.end);
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  return merged;
}

export function playerPlayedMs(state: MatchState, playerId: string, now: number): number {
  const own = state.intervals.filter((i) => i.playerId === playerId).map(intervalSpan);
  return spansPlayedMs(mergeSpans(own, now), state.clockSegments, now);
}

/**
 * Reloj de partido en un instante real: Σ segmentos ∩ (−∞, timestamp].
 * No recibe `now` porque un segmento abierto cuenta solo hasta `timestamp`:
 * se pregunta "cuánto reloj había entonces", no "cuánto hay ahora".
 */
export function toMatchTimeMs(segments: readonly ClockSegment[], timestamp: number): number {
  let total = 0;
  for (const s of segments) {
    total += Math.max(0, Math.min(closeAt(s.endedAt, timestamp), timestamp) - s.startedAt);
  }
  return total;
}

/**
 * Instante real en el que el reloj de partido marcaba `matchTimeMs`. Si cae en
 * una frontera entre dos segmentos devuelve el final del primero (el momento en
 * que el reloj se paró). `null` si el reloj aún no ha llegado tan lejos.
 */
export function fromMatchTimeMs(
  segments: readonly ClockSegment[],
  matchTimeMs: number,
  now: number,
): number | null {
  let remaining = Math.max(0, matchTimeMs);
  for (const s of segments) {
    const duration = spanMs(segmentSpan(s), now);
    if (remaining <= duration) return s.startedAt + remaining;
    remaining -= duration;
  }
  return null;
}

/** Fracción jugada respecto al reloj real transcurrido, acotada a 0..1. */
export function playedShare(played: number, clock: number): number {
  if (clock <= 0) return 0;
  return Math.min(1, Math.max(0, played / clock));
}

/** 'mm:ss' con minutos sin tope ('125:07'); nunca negativo; trunca, no redondea. */
export function formatClock(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.floor(Math.max(0, ms) / 1000) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
