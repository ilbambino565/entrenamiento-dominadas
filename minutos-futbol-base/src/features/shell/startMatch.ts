import { createMatchSession, type MatchSession } from '../../app-services/createMatchSession';
import { DELETED_PLAYER_NAME, toPlayerInfo, type LineupEntry } from '../../core';
import type { Match, MatchPlayer } from '../../core/match';
import type { MatchSetupDraft } from '../../core/matchSetup';
import { GAME_FORMATS } from '../../core/formats';
import type { Player, PlayerInfo, Team } from '../../core/team';
import { uuidv7 } from '../../lib/uuid';
import type { Persistence } from './persistence';
import { trackMatchProgress, type MatchProgressTracker } from './trackMatchProgress';

/**
 * Crea el partido de verdad (M4): la fila `match` con su convocatoria, la
 * sesión sobre la timeline persistente y el seguimiento del progreso. Si
 * guardar la fila falla no se abre nada (el entrenador sigue en P7 y puede
 * reintentar); una vez creada, la sesión se crea UNA vez (el shell la guarda en
 * su estado) y se libera con `endMatch`.
 */
export interface StartMatchInput {
  persistence: Persistence;
  team: Team;
  /** Borrador de P5, ya validado. */
  draft: MatchSetupDraft;
  /** La plantilla completa; se usan los convocados. */
  players: readonly Player[];
  convocated: readonly string[];
  lineup: readonly LineupEntry[];
  bench: readonly string[];
  now?: () => number;
}

export interface ActiveMatch {
  matchId: string;
  rival: string;
  teamName: string;
  session: MatchSession;
  players: Record<string, PlayerInfo>;
  lineup: readonly LineupEntry[];
  bench: readonly string[];
  tracker: MatchProgressTracker;
}

const MINUTE_MS = 60_000;

export async function startMatch(input: StartMatchInput): Promise<ActiveMatch> {
  const { persistence, team, draft, players, convocated, lineup, bench } = input;
  const now = input.now ?? Date.now;
  if (draft.scheduledAt === null || draft.periodMinutes === null) throw new Error('Los datos del partido no están completos');

  const at = now();
  const matchId = uuidv7(at);
  const playersOnField = GAME_FORMATS[team.defaultFormat].playersOnField;
  const match: Match = {
    id: matchId,
    teamId: team.id,
    opponent: draft.opponent,
    scheduledAt: draft.scheduledAt,
    format: team.defaultFormat,
    playersOnField,
    periodsCount: draft.periodsCount,
    periodDurationMs: draft.periodMinutes * MINUTE_MS,
    homeAway: draft.homeAway,
    competition: draft.competition === '' ? null : draft.competition,
    matchday: draft.matchday === '' ? null : draft.matchday,
    status: 'DRAFT',
    currentPeriod: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: at,
    updatedAt: at,
  };

  const chosen = new Set(convocated);
  const squad = players.filter((p) => chosen.has(p.id));
  const starters = new Set(lineup.map((e) => e.playerId));
  const goalkeepers = new Set(lineup.filter((e) => e.goalkeeper === true).map((e) => e.playerId));
  const convocation: MatchPlayer[] = squad.map((p) => ({
    id: `${matchId}:${p.id}`,
    matchId,
    playerId: p.id,
    shirtNumber: p.shirtNumber,
    isGoalkeeper: starters.has(p.id) ? goalkeepers.has(p.id) : p.isGoalkeeper,
    inInitialLineup: starters.has(p.id),
    benchOrder: starters.has(p.id) ? null : bench.indexOf(p.id) + 1 || null,
  }));
  await persistence.matches.createMatch(match, convocation);

  return openActiveMatch({ persistence, team, match, squadIds: squad.map((p) => p.id), players: squad, lineup, bench, now });
}

interface OpenActiveMatchInput {
  persistence: Persistence;
  team: Team;
  match: Match;
  /** Convocados en orden de convocatoria. */
  squadIds: readonly string[];
  /** Jugadores de la plantilla que se conocen; un convocado sin ficha (eliminado) sale como "Jugador eliminado". */
  players: readonly Player[];
  lineup: readonly LineupEntry[];
  bench: readonly string[];
  now: () => number;
}

/** Sesión sobre la timeline persistente + seguimiento del progreso: lo que comparten crear y recuperar un partido. */
export function openActiveMatch(input: OpenActiveMatchInput): ActiveMatch {
  const { persistence, team, match, squadIds, players, lineup, bench, now } = input;
  const session = createMatchSession({
    config: {
      matchId: match.id,
      playersOnField: match.playersOnField,
      periodsCount: match.periodsCount,
      periodDurationMs: match.periodDurationMs,
      squad: [...squadIds],
    },
    store: persistence.events,
    cameraSettings: null,
    now,
  });
  const tracker = trackMatchProgress(session.engine, persistence.matches, match.id, match, now);

  const known = new Map(players.map((p) => [p.id, p]));
  const info: Record<string, PlayerInfo> = {};
  for (const id of squadIds) {
    const player = known.get(id);
    info[id] = player ? toPlayerInfo(player, team.displayNameMode) : { id, name: DELETED_PLAYER_NAME, number: 0 };
  }
  return { matchId: match.id, rival: match.opponent, teamName: team.name, session, players: info, lineup, bench, tracker };
}

/** Deja de seguir el progreso (esperando lo pendiente) y libera la sesión. Nunca rechaza. */
export async function endMatch(match: ActiveMatch): Promise<void> {
  try {
    await match.tracker.stop();
    await match.session.dispose();
  } catch (error) {
    console.warn('[match] no se pudo cerrar la sesión', error);
  }
}
