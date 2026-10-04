import type { Player, Team } from '../core/team';
import { parseStoredPlayer, parseStoredTeam, playerToRow, rowToPlayer, rowToTeam, teamToRow } from './squadMappers';
import { SquadRepositoryError, type KeyValueStorage, type SquadRepository } from './squadRepository';

/**
 * SquadRepository en memoria, con almacén clave-valor opcional.
 *
 * - Sin `storage`: solo memoria (tests, desarrollo).
 * - Con `storage` (web: localStorage): al crearse carga el JSON de
 *   `storageKey`; si no se puede interpretar NO lo pisa (lo copia a
 *   `<storageKey>.corrupt` y arranca vacío) y tras cada escritura confirmada
 *   vuelve a serializar TODO (`{ version, team, players }`). La escritura al
 *   storage va antes de tocar la memoria: si falla, el estado no cambia y la
 *   promesa rechaza, igual que una transacción de SQLite.
 *
 * Reproduce las semánticas del repositorio SQLite para que el servicio no
 * note la diferencia: orden de `listPlayers`, eliminados fuera de la lista
 * pero visibles por id, `getTeam` = el de `createdAt` menor, lotes todo o
 * nada y copias defensivas (nunca se devuelve ni se guarda el objeto del
 * llamador). No hay claves foráneas: el único control del lote es que todos
 * los jugadores sean del mismo equipo. Con storage solo se persiste el equipo
 * que devuelve `getTeam` (el MVP no crea más de uno).
 */

export const DEFAULT_SQUAD_STORAGE_KEY = 'minutos-futbol-base.squad.v1';
export const SQUAD_STORAGE_VERSION = 1;

export interface InMemorySquadRepositoryOptions {
  storage?: KeyValueStorage;
  storageKey?: string;
}

interface SquadData {
  teams: Map<string, Team>;
  players: Map<string, Player>;
}

/** Forma del JSON guardado en el storage. */
export interface StoredSquad {
  version: typeof SQUAD_STORAGE_VERSION;
  team: Team | null;
  players: Player[];
}

const empty = (): SquadData => ({ teams: new Map(), players: new Map() });

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** El mismo orden que `ORDER BY sort_order, created_at, id`. */
const byRosterOrder = (a: Player, b: Player): number =>
  a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || compareText(a.id, b.id);

/** El mismo criterio que `ORDER BY created_at LIMIT 1` (sin empates reales: el MVP tiene un equipo). */
function earliestTeam(teams: Map<string, Team>): Team | null {
  let first: Team | null = null;
  for (const team of teams.values()) if (!first || team.createdAt < first.createdAt) first = team;
  return first;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseStored(raw: string): SquadData {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== SQUAD_STORAGE_VERSION) {
    throw new Error(`versión o forma desconocida (version=${String(isRecord(parsed) ? parsed.version : parsed)})`);
  }
  if (!Array.isArray(parsed.players)) throw new Error('players no es una lista');
  const data = empty();
  if (parsed.team != null) {
    const team = parseStoredTeam(parsed.team);
    data.teams.set(team.id, team);
  }
  for (const item of parsed.players) {
    const player = parseStoredPlayer(item);
    data.players.set(player.id, player);
  }
  return data;
}

function serialize(data: SquadData): string {
  const stored: StoredSquad = {
    version: SQUAD_STORAGE_VERSION,
    team: earliestTeam(data.teams),
    players: [...data.players.values()],
  };
  return JSON.stringify(stored);
}

function loadFromStorage(storage: KeyValueStorage, storageKey: string): SquadData {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch (error) {
    console.warn(`[squad] No se pudo leer "${storageKey}"; se arranca con la plantilla vacía`, error);
    return empty();
  }
  if (raw == null) return empty();
  try {
    return parseStored(raw);
  } catch (error) {
    // No se pisa lo que hay: una versión futura o una persona pueden
    // recuperarlo de la copia. La clave original se sobrescribirá en la
    // primera escritura confirmada.
    const backupKey = `${storageKey}.corrupt`;
    console.warn(`[squad] "${storageKey}" no se puede interpretar; se copia a "${backupKey}" y se arranca vacío`, error);
    try {
      storage.setItem(backupKey, raw);
    } catch (copyError) {
      console.warn(`[squad] Tampoco se pudo guardar la copia en "${backupKey}"`, copyError);
    }
    return empty();
  }
}

const storageError = (message: string, cause: unknown): SquadRepositoryError =>
  new SquadRepositoryError('STORAGE', `${message}: ${cause instanceof Error ? cause.message : String(cause)}`, cause);

/**
 * Copia de entrada: el mismo viaje que haría por SQLite (objeto → fila →
 * objeto), así lo guardado es un objeto nuevo, plano y validado; lo que no
 * se puede almacenar (un BigInt, un objeto donde va un texto) rechaza con
 * 'STORAGE' como lo haría el driver, y sin tocar nada.
 */
function admitTeam(team: Team): Team {
  try {
    return rowToTeam(teamToRow(team));
  } catch (error) {
    throw storageError('saveTeam: el equipo no se puede guardar', error);
  }
}

function admitPlayer(player: Player, operation: string): Player {
  try {
    return rowToPlayer(playerToRow(player));
  } catch (error) {
    throw storageError(`${operation}: el jugador no se puede guardar`, error);
  }
}

export function createInMemorySquadRepository(options: InMemorySquadRepositoryOptions = {}): SquadRepository {
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? DEFAULT_SQUAD_STORAGE_KEY;
  let data: SquadData = storage ? loadFromStorage(storage, storageKey) : empty();

  /** Aplica `mutate` sobre una copia del estado y la confirma solo si el storage la acepta. */
  const commit = (mutate: (next: SquadData) => void): void => {
    const next: SquadData = { teams: new Map(data.teams), players: new Map(data.players) };
    mutate(next);
    if (storage) {
      let json: string;
      try {
        json = serialize(next);
      } catch (error) {
        throw storageError('No se pudo serializar la plantilla', error);
      }
      try {
        storage.setItem(storageKey, json);
      } catch (error) {
        throw storageError(`No se pudo guardar la plantilla en "${storageKey}"`, error);
      }
    }
    data = next;
  };

  const savePlayers: SquadRepository['savePlayers'] = async (players) => {
    if (players.length === 0) return;
    const admitted = players.map((player) => admitPlayer(player, 'savePlayers'));
    const teamIds = new Set(admitted.map((player) => player.teamId));
    if (teamIds.size > 1) {
      throw new SquadRepositoryError(
        'STORAGE',
        `savePlayers: todos los jugadores del lote deben ser del mismo equipo (hay ${teamIds.size})`,
      );
    }
    commit((next) => {
      for (const player of admitted) next.players.set(player.id, player);
    });
  };

  return {
    async getTeam() {
      const team = earliestTeam(data.teams);
      return team ? { ...team } : null;
    },

    async saveTeam(team) {
      const admitted = admitTeam(team);
      commit((next) => next.teams.set(admitted.id, admitted));
    },

    async listPlayers(teamId) {
      return [...data.players.values()]
        .filter((player) => player.teamId === teamId && player.deletedAt == null)
        .sort(byRosterOrder)
        .map((player) => ({ ...player }));
    },

    async getPlayer(id) {
      const player = data.players.get(id);
      return player ? { ...player } : null;
    },

    async savePlayer(player) {
      const admitted = admitPlayer(player, 'savePlayer');
      commit((next) => next.players.set(admitted.id, admitted));
    },

    savePlayers,
  };
}
