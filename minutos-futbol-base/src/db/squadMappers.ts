import { GAME_FORMATS, type GameFormatId } from '../core/formats';
import type { DisplayNameMode, Player, Team } from '../core/team';
import { SquadRepositoryError } from './squadRepository';

/**
 * Filas de `team` y `player` ↔ `Team` / `Player` (core/team.ts).
 *
 * La ida es mecánica (camelCase → snake_case, booleanos → 0/1). La vuelta es
 * desconfiada, como `mappers.ts`: SQLite no comprueba tipos (afinidad, no
 * restricción), así que un formato desconocido, un texto donde va un número o
 * un 2 donde va un booleano lanza `SquadRepositoryError` 'CORRUPT' con el id,
 * en vez de colarse en el dominio y romper la convocatoria con un error peor.
 * Las mismas comprobaciones sirven para el JSON del repositorio en memoria
 * (`parseStoredTeam` / `parseStoredPlayer`), que tampoco es de fiar.
 */

export interface TeamRow {
  id: string;
  name: string;
  category: string | null;
  default_format: string;
  default_formation: string | null;
  periods_count: number;
  period_duration_ms: number;
  display_name_mode: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface PlayerRow {
  id: string;
  team_id: string;
  first_name: string;
  last_name: string | null;
  shirt_number: number | null;
  /** Booleanos como INTEGER 0/1. */
  is_goalkeeper: number;
  is_active: number;
  photo_uri: string | null;
  photo_consent: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const DISPLAY_NAME_MODES = ['full', 'first_initial', 'first'] as const satisfies readonly DisplayNameMode[];
const GAME_FORMAT_IDS = Object.keys(GAME_FORMATS) as GameFormatId[];

type Table = 'team' | 'player';

function corrupt(table: Table, id: unknown, reason: string): SquadRepositoryError {
  return new SquadRepositoryError('CORRUPT', `Fila corrupta en ${table} (id=${String(id)}): ${reason}`);
}

/** Lectores de columna que lanzan 'CORRUPT' con tabla, id y columna cuando el valor no es del tipo esperado. */
function reader(table: Table, id: unknown) {
  const fail = (column: string, reason: string) => corrupt(table, id, `${column} ${reason}`);
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

export function teamToRow(team: Team): TeamRow {
  return {
    id: team.id,
    name: team.name,
    category: team.category ?? null,
    default_format: team.defaultFormat,
    default_formation: team.defaultFormation ?? null,
    periods_count: team.periodsCount,
    period_duration_ms: team.periodDurationMs,
    display_name_mode: team.displayNameMode,
    created_at: team.createdAt,
    updated_at: team.updatedAt,
    // `Team` no tiene deletedAt: un equipo que se guarda está vivo.
    deleted_at: null,
  };
}

export function rowToTeam(row: TeamRow): Team {
  const read = reader('team', row.id);
  read.integerOrNull('deleted_at', row.deleted_at);
  return {
    id: read.text('id', row.id),
    name: read.text('name', row.name),
    category: read.textOrNull('category', row.category),
    defaultFormat: read.oneOf('default_format', row.default_format, GAME_FORMAT_IDS),
    defaultFormation: read.textOrNull('default_formation', row.default_formation),
    periodsCount: read.integer('periods_count', row.periods_count),
    periodDurationMs: read.integer('period_duration_ms', row.period_duration_ms),
    displayNameMode: read.oneOf('display_name_mode', row.display_name_mode, DISPLAY_NAME_MODES),
    createdAt: read.integer('created_at', row.created_at),
    updatedAt: read.integer('updated_at', row.updated_at),
  };
}

export function playerToRow(player: Player): PlayerRow {
  return {
    id: player.id,
    team_id: player.teamId,
    first_name: player.firstName,
    last_name: player.lastName ?? null,
    shirt_number: player.shirtNumber ?? null,
    is_goalkeeper: player.isGoalkeeper ? 1 : 0,
    is_active: player.isActive ? 1 : 0,
    photo_uri: player.photoUri ?? null,
    photo_consent: player.photoConsent ? 1 : 0,
    sort_order: player.sortOrder,
    created_at: player.createdAt,
    updated_at: player.updatedAt,
    deleted_at: player.deletedAt ?? null,
  };
}

export function rowToPlayer(row: PlayerRow): Player {
  const read = reader('player', row.id);
  return {
    id: read.text('id', row.id),
    teamId: read.text('team_id', row.team_id),
    firstName: read.text('first_name', row.first_name),
    lastName: read.textOrNull('last_name', row.last_name),
    shirtNumber: read.integerOrNull('shirt_number', row.shirt_number),
    isGoalkeeper: read.flag('is_goalkeeper', row.is_goalkeeper),
    isActive: read.flag('is_active', row.is_active),
    photoUri: read.textOrNull('photo_uri', row.photo_uri),
    photoConsent: read.flag('photo_consent', row.photo_consent),
    sortOrder: read.integer('sort_order', row.sort_order),
    createdAt: read.integer('created_at', row.created_at),
    updatedAt: read.integer('updated_at', row.updated_at),
    deletedAt: read.integerOrNull('deleted_at', row.deleted_at),
  };
}

/** Un booleano pasa a 0/1; cualquier otra cosa se deja tal cual para que `flag` la rechace. */
const flagOf = (value: unknown): unknown => (typeof value === 'boolean' ? (value ? 1 : 0) : value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Valida un `Team` que viene de fuera del proceso (JSON de localStorage) con
 * las mismas reglas que una fila: se recolocan los campos en forma de fila
 * SIN coaccionar nada y se pasa por `rowToTeam`. Devuelve un objeto nuevo.
 */
export function parseStoredTeam(value: unknown): Team {
  if (!isRecord(value)) throw corrupt('team', '?', 'no es un objeto');
  const row: Record<keyof TeamRow, unknown> = {
    id: value.id,
    name: value.name,
    category: value.category,
    default_format: value.defaultFormat,
    default_formation: value.defaultFormation,
    periods_count: value.periodsCount,
    period_duration_ms: value.periodDurationMs,
    display_name_mode: value.displayNameMode,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    deleted_at: null,
  };
  return rowToTeam(row as TeamRow);
}

/** Igual que `parseStoredTeam` para un `Player`. */
export function parseStoredPlayer(value: unknown): Player {
  if (!isRecord(value)) throw corrupt('player', '?', 'no es un objeto');
  const row: Record<keyof PlayerRow, unknown> = {
    id: value.id,
    team_id: value.teamId,
    first_name: value.firstName,
    last_name: value.lastName,
    shirt_number: value.shirtNumber,
    is_goalkeeper: flagOf(value.isGoalkeeper),
    is_active: flagOf(value.isActive),
    photo_uri: value.photoUri,
    photo_consent: flagOf(value.photoConsent),
    sort_order: value.sortOrder,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    deleted_at: value.deletedAt,
  };
  return rowToPlayer(row as PlayerRow);
}
