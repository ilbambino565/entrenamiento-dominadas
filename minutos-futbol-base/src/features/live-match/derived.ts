import { matchClockMs, toMatchTimeMs, type MatchState } from '../../core';

/** Tono del anillo de la ficha: neutro, sin verde/rojo para no juzgar (docs/05 §5.3). */
export type RingTone = 'low' | 'even' | 'high';

export function ringTone(playedMs: number, teamAvgMs: number): RingTone {
  if (playedMs < 0.5 * teamAvgMs) return 'low';
  if (playedMs > 1.4 * teamAvgMs) return 'high';
  return 'even';
}

/**
 * Tiempo seguido que un suplente lleva fuera: desde que cerró su último
 * tramo o, si nunca entró, desde el pitido inicial. `null` si el partido no
 * ha empezado o ya acabó (no tiene sentido mostrarlo).
 *
 * Se mide en TIEMPO DE PARTIDO, no real: en PAUSA y en DESCANSO se congela
 * igual que los minutos jugados (docs/05 P8), porque sirve para decidir la
 * rotación y una pausa de 15' no es "15' esperando".
 */
export function benchElapsedMs(state: MatchState, playerId: string, now: number): number | null {
  if (!['RUNNING', 'PAUSED', 'HALFTIME'].includes(state.status)) return null;
  const kickoff = state.clockSegments[0]?.startedAt;
  if (kickoff === undefined) return null;
  let since = kickoff;
  for (const interval of state.intervals) {
    if (interval.playerId === playerId && interval.endedAt !== null && interval.endedAt > since) since = interval.endedAt;
  }
  // max(0, …) por si el reloj del sistema retrocede entre la salida y `now`.
  return Math.max(0, matchClockMs(state.clockSegments, now) - toMatchTimeMs(state.clockSegments, since));
}
