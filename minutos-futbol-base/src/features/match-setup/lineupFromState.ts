import type { LineupEntry, MatchState } from '../../core';

/**
 * Lo que P7 entrega al pulsar INICIAR PARTIDO: los titulares con su posición
 * (y la marca de portero) y el banquillo en orden de convocatoria. Se lee del
 * estado del motor de la pantalla, donde el entrenador ha movido las fichas.
 */
export function lineupFromState(state: MatchState): { lineup: LineupEntry[]; bench: string[] } {
  const lineup: LineupEntry[] = [];
  const bench: string[] = [];
  for (const id of state.config.squad) {
    const p = state.players[id];
    if (!p) continue;
    if (p.location === 'FIELD' && p.position) {
      lineup.push(p.isGoalkeeper ? { playerId: id, position: { ...p.position }, goalkeeper: true } : { playerId: id, position: { ...p.position } });
    } else if (p.location === 'BENCH') {
      bench.push(id);
    }
  }
  return { lineup, bench };
}

export const fieldCount = (state: MatchState): number =>
  Object.values(state.players).filter((p) => p.location === 'FIELD').length;
