import { createMatchSession, type MatchSession } from '../../app-services/createMatchSession';
import { DELETED_PLAYER_NAME, toPlayerInfo } from '../../core';
import type { Match } from '../../core/match';
import type { MatchState } from '../../core/state';
import type { Player, PlayerInfo, Team } from '../../core/team';
import type { Persistence } from './persistence';

/**
 * Abre un partido guardado SOLO para verlo (resumen P9): carga su timeline en
 * un motor propio, sin seguimiento de progreso y sin mandar ningún comando,
 * así que no escribe nada. Hay que llamar a `dispose()` de la sesión al cerrar.
 */
export interface ViewedMatch {
  match: Match;
  session: MatchSession;
  state: MatchState;
  players: Record<string, PlayerInfo>;
}

export async function viewMatch(input: { persistence: Persistence; team: Team; players: readonly Player[]; match: Match; now?: () => number }): Promise<ViewedMatch> {
  const { persistence, team, players, match } = input;
  const squadIds = (await persistence.matches.listMatchPlayers(match.id)).map((p) => p.playerId);
  const session = createMatchSession({
    config: {
      matchId: match.id,
      playersOnField: match.playersOnField,
      periodsCount: match.periodsCount,
      periodDurationMs: match.periodDurationMs,
      squad: squadIds,
    },
    store: persistence.events,
    cameraSettings: null,
    now: input.now,
  });
  try {
    const state = await session.engine.load();
    const known = new Map(players.map((p) => [p.id, p]));
    const info: Record<string, PlayerInfo> = {};
    for (const id of squadIds) {
      const player = known.get(id);
      info[id] = player ? toPlayerInfo(player, team.displayNameMode) : { id, name: DELETED_PLAYER_NAME, number: 0 };
    }
    return { match, session, state, players: info };
  } catch (error) {
    await session.dispose();
    throw error;
  }
}
