import type { AnyMatchEvent, MatchEvent } from '../../core';
import type { PlayerInfo } from './demoTeam';

const nameOf = (players: Record<string, PlayerInfo>, id: string | null): string =>
  (id && players[id]?.name) || id || '?';

/** Rótulo corto de lo que desharía el botón (docs/03 §3.5): se lee de un vistazo. */
export function describeUndo(event: MatchEvent, players: Record<string, PlayerInfo>): string {
  const e = event as AnyMatchEvent;
  switch (e.type) {
    case 'SUBSTITUTION':
      return `${nameOf(players, e.playerId)} ⇄ ${nameOf(players, e.secondaryPlayerId)}`;
    case 'PLAYER_ENTERED':
      return `Entra ${nameOf(players, e.playerId)}`;
    case 'PLAYER_LEFT':
      return `Sale ${nameOf(players, e.playerId)}`;
    case 'MATCH_STARTED':
      return 'Inicio';
    case 'MATCH_PAUSED':
      return 'Pausa';
    case 'MATCH_RESUMED':
      return 'Reanudar';
    case 'HALFTIME_STARTED':
      return 'Descanso';
    case 'PERIOD_STARTED':
      return `${e.period}ª parte`;
    case 'MATCH_ENDED':
      return 'Final';
    case 'LINEUP_SET':
      return 'Alineación';
    case 'PLAYER_MOVED':
      return 'Mover';
    case 'PLAYERS_SWAPPED':
      return 'Intercambio';
    case 'GOALKEEPER_SET':
      return 'Portero';
    case 'PLAYER_ADDED':
      return `Alta ${nameOf(players, e.playerId)}`;
    case 'PLAYER_UNAVAILABLE':
      return nameOf(players, e.playerId);
    default:
      return e.type;
  }
}
