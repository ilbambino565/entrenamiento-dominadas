import type { Match, MatchPlayer } from '../core/match';
import { matchPlayerToRow, matchToRow, rowToMatch, rowToMatchPlayer, type MatchPlayerRow } from './matchMappers';
import { DEFAULT_RECENT_MATCHES_LIMIT, MatchRepositoryError, type MatchRepository } from './matchRepository';
import type { KeyValueStorage } from './squadRepository';

/**
 * MatchRepository en memoria, con almacén clave-valor opcional. Reproduce las
 * semánticas del SQLite: id duplicado rechaza, un partido y su convocatoria
 * entran juntos o no entran, orden de `listRecentMatches` y copias defensivas
 * (objeto → fila → objeto, como el viaje por la base). No hay claves foráneas.
 *
 * Con `storage` (web: localStorage) carga al crearse `{ version, matches,
 * players }` de `storageKey`; si no se puede interpretar NO lo pisa (lo copia a
 * `<storageKey>.corrupt` y arranca vacío) y tras cada escritura vuelve a
 * serializar todo, ANTES de tocar la memoria: si el storage falla, la promesa
 * rechaza con 'STORAGE' y el estado no cambia. Son solo filas pequeñas (la
 * timeline va aparte, en `inMemoryEventStore`).
 */

export const DEFAULT_MATCHES_STORAGE_KEY = 'minutos-futbol-base.matches.v1';
export const MATCHES_STORAGE_VERSION = 1;

export interface InMemoryMatchRepositoryOptions {
  storage?: KeyValueStorage;
  storageKey?: string;
}

/** Forma del JSON guardado en el storage. */
export interface StoredMatches {
  version: typeof MATCHES_STORAGE_VERSION;
  matches: Match[];
  /** Convocatoria de cada partido, por id de partido, en orden de convocatoria. */
  players: Record<string, MatchPlayer[]>;
}

interface MatchData {
  matches: Map<string, Match>;
  players: Map<string, MatchPlayer[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Un booleano pasa a 0/1; cualquier otra cosa se deja tal cual para que `flag` la rechace. */
const flagOf = (value: unknown): unknown => (typeof value === 'boolean' ? (value ? 1 : 0) : value);

/** Valida un `Match` que viene de fuera del proceso (JSON) con las mismas reglas que una fila. */
function parseStoredMatch(value: unknown): Match {
  if (!isRecord(value)) throw new Error('un partido no es un objeto');
  return rowToMatch(matchToRow(value as unknown as Match));
}

function parseStoredMatchPlayer(value: unknown): MatchPlayer {
  if (!isRecord(value)) throw new Error('un convocado no es un objeto');
  const row: Record<keyof MatchPlayerRow, unknown> = {
    id: value.id,
    match_id: value.matchId,
    player_id: value.playerId,
    shirt_number: value.shirtNumber,
    is_goalkeeper: flagOf(value.isGoalkeeper),
    in_initial_lineup: flagOf(value.inInitialLineup),
    bench_order: value.benchOrder,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
  };
  return rowToMatchPlayer(row as unknown as MatchPlayerRow);
}

function parseStored(raw: string): MatchData {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== MATCHES_STORAGE_VERSION) {
    throw new Error(`versión o forma desconocida (version=${String(isRecord(parsed) ? parsed.version : parsed)})`);
  }
  if (!Array.isArray(parsed.matches)) throw new Error('matches no es una lista');
  if (!isRecord(parsed.players)) throw new Error('players no es un objeto');
  const data: MatchData = { matches: new Map(), players: new Map() };
  for (const item of parsed.matches) {
    const match = parseStoredMatch(item);
    data.matches.set(match.id, match);
  }
  for (const [matchId, list] of Object.entries(parsed.players)) {
    if (!Array.isArray(list)) throw new Error(`la convocatoria de ${matchId} no es una lista`);
    data.players.set(matchId, list.map(parseStoredMatchPlayer));
  }
  return data;
}

function loadFromStorage(storage: KeyValueStorage, storageKey: string): MatchData {
  const empty = (): MatchData => ({ matches: new Map(), players: new Map() });
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch (error) {
    console.warn(`[matches] No se pudo leer "${storageKey}"; se arranca sin partidos`, error);
    return empty();
  }
  if (raw == null) return empty();
  try {
    return parseStored(raw);
  } catch (error) {
    const backupKey = `${storageKey}.corrupt`;
    // Solo el tipo del error: el mensaje de JSON.parse incluye un trozo del texto.
    console.warn(`[matches] "${storageKey}" no se puede interpretar (${error instanceof Error ? error.name : 'error'}); se copia a "${backupKey}" y se arranca sin partidos`);
    try {
      storage.setItem(backupKey, raw);
    } catch (copyError) {
      console.warn(`[matches] Tampoco se pudo guardar la copia en "${backupKey}"`, copyError);
    }
    return empty();
  }
}

/** Estados con el reloj en juego o parado a medias: lo que P0 ofrece continuar. */
export const IN_PROGRESS: readonly Match['status'][] = ['RUNNING', 'PAUSED', 'HALFTIME'];

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

export function createInMemoryMatchRepository(options: InMemoryMatchRepositoryOptions = {}): MatchRepository {
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? DEFAULT_MATCHES_STORAGE_KEY;
  let data: MatchData = storage ? loadFromStorage(storage, storageKey) : { matches: new Map(), players: new Map() };

  /** Aplica `mutate` sobre una copia y la confirma solo si el storage la acepta. */
  const commit = (mutate: (next: MatchData) => void): void => {
    const next: MatchData = { matches: new Map(data.matches), players: new Map(data.players) };
    mutate(next);
    if (storage) {
      const stored: StoredMatches = {
        version: MATCHES_STORAGE_VERSION,
        matches: [...next.matches.values()],
        players: Object.fromEntries(next.players),
      };
      try {
        storage.setItem(storageKey, JSON.stringify(stored));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new MatchRepositoryError('STORAGE', `No se pudieron guardar los partidos en "${storageKey}": ${message}`, error);
      }
    }
    data = next;
  };

  return {
    async createMatch(match, convocated) {
      const admittedMatch = admit('createMatch', () => rowToMatch(matchToRow(match)));
      const admittedPlayers = admit('createMatch', () =>
        convocated.map((player) => rowToMatchPlayer(matchPlayerToRow(player, match.createdAt))),
      );
      if (data.matches.has(admittedMatch.id)) {
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
      commit((next) => {
        next.matches.set(admittedMatch.id, admittedMatch);
        next.players.set(admittedMatch.id, admittedPlayers);
      });
    },

    async getMatch(id) {
      const match = data.matches.get(id);
      return match ? { ...match } : null;
    },

    async listRecentMatches(limit = DEFAULT_RECENT_MATCHES_LIMIT) {
      return [...data.matches.values()]
        .sort(byRecent)
        .slice(0, limit)
        .map((match) => ({ ...match }));
    },

    async findInProgressMatch() {
      const inProgress = [...data.matches.values()]
        .filter((m) => IN_PROGRESS.includes(m.status))
        .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || compareText(a.id, b.id));
      return inProgress[0] ? { ...inProgress[0] } : null;
    },

    async listMatchPlayers(matchId) {
      return (data.players.get(matchId) ?? []).map((player) => ({ ...player }));
    },

    async saveProgress(matchId, progress) {
      const match = data.matches.get(matchId);
      if (!match) throw new MatchRepositoryError('NOT_FOUND', `saveProgress: no existe el partido ${matchId}`);
      const next = admit('saveProgress', () => rowToMatch(matchToRow({ ...match, ...progress })));
      commit((draft) => draft.matches.set(matchId, next));
    },
  };
}
