import type { HomeAway } from '../core/match';
import type { Fixture } from '../core/fixture';
import { FixtureRepositoryError } from './fixtureRepository';

/**
 * Filas de `fixture` ↔ `Fixture`. Como en los demás mappers, la ida es
 * mecánica y la vuelta desconfiada: un valor que no es del tipo esperado lanza
 * 'CORRUPT' con la tabla y el id.
 */
export interface FixtureRow {
  id: string;
  team_id: string;
  matchday: number;
  matchday_date: number | null;
  opponent: string;
  home_away: string;
  venue: string | null;
  scheduled_at: number;
  has_time: number;
  competition: string | null;
  season: string | null;
  match_id: string | null;
  created_at: number;
  updated_at: number;
}

const HOME_AWAY = ['HOME', 'AWAY'] as const satisfies readonly HomeAway[];

export function fixtureToRow(f: Fixture): FixtureRow {
  return {
    id: f.id,
    team_id: f.teamId,
    matchday: f.matchday,
    matchday_date: f.matchdayDate ?? null,
    opponent: f.opponent,
    home_away: f.homeAway,
    venue: f.venue ?? null,
    scheduled_at: f.scheduledAt,
    has_time: f.hasTime ? 1 : 0,
    competition: f.competition ?? null,
    season: f.season ?? null,
    match_id: f.matchId ?? null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}

export function rowToFixture(row: FixtureRow): Fixture {
  const fail = (column: string, reason: string) =>
    new FixtureRepositoryError('CORRUPT', `Fila corrupta en fixture (id=${String(row.id)}): ${column} ${reason}`);
  const text = (column: string, value: unknown): string => {
    if (typeof value !== 'string') throw fail(column, 'no es texto');
    return value;
  };
  const integer = (column: string, value: unknown): number => {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw fail(column, 'no es un entero');
    return value;
  };
  const textOrNull = (column: string, value: unknown): string | null => (value == null ? null : text(column, value));
  const homeAway = row.home_away;
  if (typeof homeAway !== 'string' || !(HOME_AWAY as readonly string[]).includes(homeAway)) {
    throw fail('home_away', `desconocido "${String(homeAway)}"`);
  }
  if (row.has_time !== 0 && row.has_time !== 1) throw fail('has_time', 'no es 0/1');
  return {
    id: text('id', row.id),
    teamId: text('team_id', row.team_id),
    matchday: integer('matchday', row.matchday),
    matchdayDate: row.matchday_date == null ? null : integer('matchday_date', row.matchday_date),
    opponent: text('opponent', row.opponent),
    homeAway: homeAway as HomeAway,
    venue: textOrNull('venue', row.venue),
    scheduledAt: integer('scheduled_at', row.scheduled_at),
    hasTime: row.has_time === 1,
    competition: textOrNull('competition', row.competition),
    season: textOrNull('season', row.season),
    matchId: textOrNull('match_id', row.match_id),
    createdAt: integer('created_at', row.created_at),
    updatedAt: integer('updated_at', row.updated_at),
  };
}
