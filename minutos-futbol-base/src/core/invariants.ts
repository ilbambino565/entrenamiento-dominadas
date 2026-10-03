import type { MatchState } from './state';

/**
 * Invariantes del estado (docs/02 §2.5). Devuelve una lista de violaciones
 * legibles, vacía si todo es coherente. No lanza: la usan los tests por
 * propiedades y la comprobación de integridad al abrir un partido, donde lo
 * útil es saber TODO lo que falla, no solo lo primero.
 *
 * No se comprueba `startedAt ≤ endedAt`: el reloj del sistema puede saltar
 * hacia atrás y eso es un hecho tolerado (la aritmética lo acota a 0), no una
 * corrupción del estado.
 */
export function checkInvariants(state: MatchState): string[] {
  const problems: string[] = [];
  const players = Object.values(state.players);
  const onField = players.filter((p) => p.location === 'FIELD');
  const openSegments = state.clockSegments.filter((s) => s.endedAt == null);
  const openIntervals = state.intervals.filter((i) => i.endedAt == null);
  const started = state.status === 'RUNNING' || state.status === 'PAUSED' || state.status === 'HALFTIME';
  const preMatch = state.status === 'DRAFT' || state.status === 'READY';

  if (onField.length > state.config.playersOnField) {
    problems.push(`Hay ${onField.length} jugadores en el campo y el máximo es ${state.config.playersOnField}`);
  }
  for (const p of players) {
    if (p.location === 'FIELD' && p.position == null) problems.push(`${p.playerId} está en el campo sin posición`);
    if (p.location === 'BENCH' && p.position != null) problems.push(`${p.playerId} está en el banquillo con posición`);
  }

  if (openSegments.length > 1) problems.push(`Hay ${openSegments.length} segmentos de reloj abiertos (máximo 1)`);
  if ((state.status === 'RUNNING') !== (openSegments.length === 1)) {
    problems.push(`Estado ${state.status} con ${openSegments.length} segmentos de reloj abiertos`);
  }
  if ((state.currentPeriod === 0) !== preMatch) {
    problems.push(`Estado ${state.status} con currentPeriod ${state.currentPeriod}`);
  }
  if (state.currentPeriod > state.config.periodsCount) {
    problems.push(`currentPeriod ${state.currentPeriod} supera periodsCount ${state.config.periodsCount}`);
  }
  for (const s of state.clockSegments) {
    if (s.period < 1 || s.period > state.currentPeriod) problems.push(`Segmento de reloj con periodo ${s.period} fuera de 1..${state.currentPeriod}`);
  }

  const openByPlayer = new Map<string, number>();
  for (const i of openIntervals) openByPlayer.set(i.playerId, (openByPlayer.get(i.playerId) ?? 0) + 1);
  for (const [playerId, count] of openByPlayer) {
    if (count > 1) problems.push(`${playerId} tiene ${count} intervalos abiertos`);
  }
  for (const i of state.intervals) {
    if (!state.players[i.playerId]) problems.push(`Intervalo de un jugador desconocido: ${i.playerId}`);
  }

  if (started) {
    // Con el partido en juego, estar en el campo y tener intervalo abierto son lo mismo.
    for (const p of players) {
      const hasOpen = openByPlayer.has(p.playerId);
      if ((p.location === 'FIELD') !== hasOpen) {
        problems.push(`${p.playerId} está en ${p.location} pero ${hasOpen ? 'tiene' : 'no tiene'} intervalo abierto`);
      }
    }
  }
  if (preMatch && (state.intervals.length > 0 || state.clockSegments.length > 0)) {
    problems.push(`Estado ${state.status} con intervalos o segmentos ya creados`);
  }
  if (state.status === 'FINISHED' && (openIntervals.length > 0 || openSegments.length > 0)) {
    problems.push(`Partido finalizado con ${openIntervals.length} intervalos y ${openSegments.length} segmentos abiertos`);
  }
  if (state.status === 'FINISHED' && state.endReason == null) problems.push('Partido finalizado sin motivo de fin');

  return problems;
}
