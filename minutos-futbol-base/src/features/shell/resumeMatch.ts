import { reduceMatch, matchClockMs } from '../../core';
import type { Match } from '../../core/match';
import type { MatchState } from '../../core/state';
import type { Player, Team } from '../../core/team';
import type { Persistence } from './persistence';
import { openActiveMatch, type ActiveMatch } from './startMatch';

/**
 * P0 "Hay un partido en curso" (docs/05 §5.3): al arrancar, un partido en
 * juego (RUNNING, PAUSED o HALFTIME) es lo que dejó una batería agotada o un
 * cierre forzoso. Su estado se regenera de la timeline, que es la verdad; la
 * fila `match` solo dice cuál buscar. Los partidos sin empezar (DRAFT, READY)
 * no se ofrecen: no hay nada que recuperar.
 */
export interface ResumableMatch {
  match: Match;
  state: MatchState;
  /** Reloj acumulado del partido en `now`. */
  clockMs: number;
  /** Convocados en orden de convocatoria. */
  squadIds: string[];
}

/** Sin `target`, el partido en juego más reciente (P0); con él, ese partido concreto (abrirlo desde la lista). */
export async function findResumable(persistence: Persistence, now: number, target?: Match): Promise<ResumableMatch | null> {
  const match = target ?? (await persistence.matches.findInProgressMatch());
  if (!match) return null;
  const squadIds = (await persistence.matches.listMatchPlayers(match.id)).map((p) => p.playerId);
  const events = await persistence.events.loadEvents(match.id);
  const state = reduceMatch(
    {
      matchId: match.id,
      playersOnField: match.playersOnField,
      periodsCount: match.periodsCount,
      periodDurationMs: match.periodDurationMs,
      squad: squadIds,
    },
    events.filter((e) => e.voidedAt === null),
  );
  return { match, state, clockMs: matchClockMs(state.clockSegments, now), squadIds };
}

/** Reabre el partido: CONTINUAR en P0. P8 carga la timeline al montarse y no repite la alineación (ya no está en DRAFT). */
export function resumeMatch(input: {
  persistence: Persistence;
  team: Team;
  players: readonly Player[];
  resumable: ResumableMatch;
  now?: () => number;
}): ActiveMatch {
  const { persistence, team, players, resumable } = input;
  return openActiveMatch({
    persistence,
    team,
    match: resumable.match,
    squadIds: resumable.squadIds,
    players,
    lineup: [],
    bench: [],
    now: input.now ?? Date.now,
  });
}
