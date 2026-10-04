import { GAME_FORMATS, type GameFormatId } from '../core/formats';
import type { HomeAway, Match, MatchPlayer } from '../core/match';
import type { MatchStatus } from '../core/state';
import { MatchRepositoryError } from './matchRepository';

/**
 * Filas de `match` y `match_player` ↔ `Match` / `MatchPlayer`. Como en
 * `squadMappers.ts`, la ida es mecánica y la vuelta desconfiada: un estado
 * desconocido o un texto donde va un número lanza 'CORRUPT' con la tabla y el id.
 */

export interface MatchRow {
  id: string;
  team_id: string;
  opponent: string;
  scheduled_at: number;
  format: string;
  players_on_field: number;
  periods_count: number;
  period_duration_ms: number;
  home_away: string | null;
  competition: string | null;
  matchday: string | null;
  status: string;
  current_period: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface MatchPlayerRow {
  id: string;
  match_id: string;
  player_id: string;
  shirt_number: number | null;
  is_goalkeeper: number;
  in_initial_lineup: number;
  bench_order: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const MATCH_STATUSES = ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'HALFTIME', 'FINISHED'] as const satisfies readonly MatchStatus[];
const HOME_AWAY = ['HOME', 'AWAY'] as const satisfies readonly HomeAway[];
const GAME_FORMAT_IDS = Object.keys(GAME_FORMATS) as GameFormatId[];

type Table = 'match' | 'match_player';

function reader(table: Table, id: unknown) {
  const fail = (column: string, reason: string) =>
    new MatchRepositoryError('CORRUPT', `Fila corrupta en ${table} (id=${String(id)}): ${column} ${reason}`);
  const text = (column: string, value: unknown): string => {
    if (typeof value !== 'string') throw fail(column, 'no es texto');
    return value;
  };
  const integer = (column: string, value: unknown): number => {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw fail(column, 'no es un entero');
    return value;
  };
  return {
    text,
    integer,
    textOrNull: (column: string, value: unknown): string | null => (value == null ? null : text(column, value)),
    integerOrNull: (column: string, value: unknown): number | null => (value == null ? null : integer(column, value)),
    flag: (column: string, value: unknown): boolean => {
      if (value !== 0 && value !== 1) throw fail(column, 'no es 0/1');
      return value === 1;
    },
    oneOf: <T extends string>(column: string, value: unknown, allowed: readonly T[]): T => {
      if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
        throw fail(column, `desconocido "${String(value)}"`);
      }
      return value as T;
    },
  };
}

export function matchToRow(match: Match): MatchRow {
  return {
    id: match.id,
    team_id: match.teamId,
    opponent: match.opponent,
    scheduled_at: match.scheduledAt,
    format: match.format,
    players_on_field: match.playersOnField,
    periods_count: match.periodsCount,
    period_duration_ms: match.periodDurationMs,
    home_away: match.homeAway ?? null,
    competition: match.competition ?? null,
    matchday: match.matchday ?? null,
    status: match.status,
    current_period: match.currentPeriod,
    started_at: match.startedAt ?? null,
    finished_at: match.finishedAt ?? null,
    created_at: match.createdAt,
    updated_at: match.updatedAt,
    // `Match` no tiene deletedAt: un partido que se guarda está vivo.
    deleted_at: null,
  };
}

export function rowToMatch(row: MatchRow): Match {
  const read = reader('match', row.id);
  return {
    id: read.text('id', row.id),
    teamId: read.text('team_id', row.team_id),
    opponent: read.text('opponent', row.opponent),
    scheduledAt: read.integer('scheduled_at', row.scheduled_at),
    format: read.oneOf('format', row.format, GAME_FORMAT_IDS),
    playersOnField: read.integer('players_on_field', row.players_on_field),
    periodsCount: read.integer('periods_count', row.periods_count),
    periodDurationMs: read.integer('period_duration_ms', row.period_duration_ms),
    homeAway: row.home_away == null ? null : read.oneOf('home_away', row.home_away, HOME_AWAY),
    competition: read.textOrNull('competition', row.competition),
    matchday: read.textOrNull('matchday', row.matchday),
    status: read.oneOf('status', row.status, MATCH_STATUSES),
    currentPeriod: read.integer('current_period', row.current_period),
    startedAt: read.integerOrNull('started_at', row.started_at),
    finishedAt: read.integerOrNull('finished_at', row.finished_at),
    createdAt: read.integer('created_at', row.created_at),
    updatedAt: read.integer('updated_at', row.updated_at),
  };
}

export function matchPlayerToRow(player: MatchPlayer, createdAt: number): MatchPlayerRow {
  return {
    id: player.id,
    match_id: player.matchId,
    player_id: player.playerId,
    shirt_number: player.shirtNumber ?? null,
    is_goalkeeper: player.isGoalkeeper ? 1 : 0,
    in_initial_lineup: player.inInitialLineup ? 1 : 0,
    bench_order: player.benchOrder ?? null,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  };
}

export function rowToMatchPlayer(row: MatchPlayerRow): MatchPlayer {
  const read = reader('match_player', row.id);
  return {
    id: read.text('id', row.id),
    matchId: read.text('match_id', row.match_id),
    playerId: read.text('player_id', row.player_id),
    shirtNumber: read.integerOrNull('shirt_number', row.shirt_number),
    isGoalkeeper: read.flag('is_goalkeeper', row.is_goalkeeper),
    inInitialLineup: read.flag('in_initial_lineup', row.in_initial_lineup),
    benchOrder: read.integerOrNull('bench_order', row.bench_order),
  };
}
