import type { Match, MatchPlayer } from '../core/match';
import { matchPlayerToRow, matchToRow, rowToMatch, rowToMatchPlayer } from './matchMappers';
import { DEFAULT_RECENT_MATCHES_LIMIT, MatchRepositoryError, type MatchRepository } from './matchRepository';

/**
 * MatchRepository en memoria. Reproduce las semánticas del SQLite: id
 * duplicado rechaza, un partido y su convocatoria entran juntos o no entran,
 * orden de `listRecentMatches` y copias defensivas (objeto → fila → objeto,
 * como el viaje por la base). No hay claves foráneas ni persistencia: la web
 * guardará el partido en curso cuando el paso "partido persistente" lo pida.
 */

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** El mismo orden que `ORDER BY scheduled_at DESC, created_at DESC, id`. */
const byRecent = (a: Match, b: Match): number =>
  b.scheduledAt - a.scheduledAt || b.createdAt - a.createdAt || compareText(a.id, b.id);

function admit<T>(operation: string, convert: () => T): T {
  try {
    return convert();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MatchRepositoryError('STORAGE', `${operation}: ${message}`, error);
  }
}

export function createInMemoryMatchRepository(): MatchRepository {
  const matches = new Map<string, Match>();
  const players = new Map<string, MatchPlayer[]>();

  return {
    async createMatch(match, convocated) {
      const admittedMatch = admit('createMatch', () => rowToMatch(matchToRow(match)));
      const admittedPlayers = admit('createMatch', () =>
        convocated.map((player) => rowToMatchPlayer(matchPlayerToRow(player, match.createdAt))),
      );
      if (matches.has(admittedMatch.id)) {
        throw new MatchRepositoryError('STORAGE', `createMatch: ya existe el partido ${admittedMatch.id}`);
      }
      const seen = new Set<string>();
      for (const player of admittedPlayers) {
        if (player.matchId !== admittedMatch.id) {
          throw new MatchRepositoryError('STORAGE', `createMatch: el convocado ${player.id} es de otro partido`);
        }
        if (seen.has(player.playerId)) {
          throw new MatchRepositoryError('STORAGE', `createMatch: jugador ${player.playerId} convocado dos veces`);
        }
        seen.add(player.playerId);
      }
      matches.set(admittedMatch.id, admittedMatch);
      players.set(admittedMatch.id, admittedPlayers);
    },

    async getMatch(id) {
      const match = matches.get(id);
      return match ? { ...match } : null;
    },

    async listRecentMatches(limit = DEFAULT_RECENT_MATCHES_LIMIT) {
      return [...matches.values()]
        .sort(byRecent)
        .slice(0, limit)
        .map((match) => ({ ...match }));
    },

    async listMatchPlayers(matchId) {
      return (players.get(matchId) ?? []).map((player) => ({ ...player }));
    },

    async saveProgress(matchId, progress) {
      const match = matches.get(matchId);
      if (!match) throw new MatchRepositoryError('NOT_FOUND', `saveProgress: no existe el partido ${matchId}`);
      const next = admit('saveProgress', () => rowToMatch(matchToRow({ ...match, ...progress })));
      matches.set(matchId, next);
    },
  };
}
