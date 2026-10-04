import type { Fixture } from '../core/fixture';
import { fixtureToRow, rowToFixture, type FixtureRow } from './fixtureMappers';
import { FixtureRepositoryError, type FixtureRepository } from './fixtureRepository';
import type { KeyValueStorage } from './squadRepository';

/**
 * FixtureRepository en memoria, con almacén clave-valor opcional (web:
 * localStorage). Mismas semánticas que el SQLite: sustituir es todo o nada,
 * orden por fecha, jornada e id, y copias defensivas (objeto → fila → objeto).
 * Con `storage` carga `{ version, fixtures }` de `storageKey` al crearse (si no
 * se puede interpretar NO lo pisa: lo copia a `<storageKey>.corrupt` y arranca
 * vacío) y tras cada escritura vuelve a serializar todo ANTES de tocar la
 * memoria; si falla, rechaza con 'STORAGE' y no cambia nada. No hay claves foráneas.
 */
export const DEFAULT_FIXTURES_STORAGE_KEY = 'minutos-futbol-base.fixtures.v1';
export const FIXTURES_STORAGE_VERSION = 1;

export interface InMemoryFixtureRepositoryOptions {
  storage?: KeyValueStorage;
  storageKey?: string;
}

/** Forma del JSON guardado en el storage. */
export interface StoredFixtures {
  version: typeof FIXTURES_STORAGE_VERSION;
  fixtures: Fixture[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byDate = (a: Fixture, b: Fixture): number => a.scheduledAt - b.scheduledAt || a.matchday - b.matchday || compareText(a.id, b.id);

/** Valida un `Fixture` que viene de fuera del proceso (JSON) con las mismas reglas que una fila. */
function parseStoredFixture(value: unknown): Fixture {
  if (!isRecord(value)) throw new Error('un partido del calendario no es un objeto');
  const row: Record<keyof FixtureRow, unknown> = {
    id: value.id,
    team_id: value.teamId,
    matchday: value.matchday,
    matchday_date: value.matchdayDate,
    opponent: value.opponent,
    home_away: value.homeAway,
    venue: value.venue,
    scheduled_at: value.scheduledAt,
    has_time: typeof value.hasTime === 'boolean' ? (value.hasTime ? 1 : 0) : value.hasTime,
    competition: value.competition,
    season: value.season,
    match_id: value.matchId,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
  return rowToFixture(row as unknown as FixtureRow);
}

function parseStored(raw: string): Map<string, Fixture> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== FIXTURES_STORAGE_VERSION) {
    throw new Error(`versión o forma desconocida (version=${String(isRecord(parsed) ? parsed.version : parsed)})`);
  }
  if (!Array.isArray(parsed.fixtures)) throw new Error('fixtures no es una lista');
  const data = new Map<string, Fixture>();
  for (const item of parsed.fixtures) {
    const fixture = parseStoredFixture(item);
    data.set(fixture.id, fixture);
  }
  return data;
}

function loadFromStorage(storage: KeyValueStorage, storageKey: string): Map<string, Fixture> {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch (error) {
    console.warn(`[fixtures] No se pudo leer "${storageKey}"; se arranca sin calendario`, error);
    return new Map();
  }
  if (raw == null) return new Map();
  try {
    return parseStored(raw);
  } catch (error) {
    const backupKey = `${storageKey}.corrupt`;
    // Solo el tipo del error: el mensaje de JSON.parse incluye un trozo del texto.
    console.warn(`[fixtures] "${storageKey}" no se puede interpretar (${error instanceof Error ? error.name : 'error'}); se copia a "${backupKey}" y se arranca sin calendario`);
    try {
      storage.setItem(backupKey, raw);
    } catch (copyError) {
      console.warn(`[fixtures] Tampoco se pudo guardar la copia en "${backupKey}"`, copyError);
    }
    return new Map();
  }
}

const admit = (fixture: Fixture, operation: string): Fixture => {
  try {
    return rowToFixture(fixtureToRow(fixture));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FixtureRepositoryError('STORAGE', `${operation}: ${message}`, error);
  }
};

export function createInMemoryFixtureRepository(options: InMemoryFixtureRepositoryOptions = {}): FixtureRepository {
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? DEFAULT_FIXTURES_STORAGE_KEY;
  let data: Map<string, Fixture> = storage ? loadFromStorage(storage, storageKey) : new Map();

  /** Aplica `mutate` sobre una copia y la confirma solo si el storage la acepta. */
  const commit = (mutate: (next: Map<string, Fixture>) => void): void => {
    const next = new Map(data);
    mutate(next);
    if (storage) {
      const stored: StoredFixtures = { version: FIXTURES_STORAGE_VERSION, fixtures: [...next.values()] };
      try {
        storage.setItem(storageKey, JSON.stringify(stored));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new FixtureRepositoryError('STORAGE', `No se pudo guardar el calendario en "${storageKey}": ${message}`, error);
      }
    }
    data = next;
  };

  return {
    async listFixtures(teamId) {
      return [...data.values()]
        .filter((f) => f.teamId === teamId)
        .sort(byDate)
        .map((f) => ({ ...f }));
    },

    async replaceFixtures(teamId, fixtures) {
      const admitted = fixtures.map((f) => admit(f, 'replaceFixtures'));
      const foreign = admitted.find((f) => f.teamId !== teamId);
      if (foreign) throw new FixtureRepositoryError('STORAGE', `replaceFixtures: el partido ${foreign.id} es de otro equipo`);
      if (new Set(admitted.map((f) => f.id)).size !== admitted.length) throw new FixtureRepositoryError('STORAGE', 'replaceFixtures: ids repetidos');
      commit((next) => {
        for (const [id, fixture] of next) if (fixture.teamId === teamId) next.delete(id);
        for (const fixture of admitted) next.set(fixture.id, fixture);
      });
    },

    async linkMatch(fixtureId, matchId, updatedAt) {
      const current = data.get(fixtureId);
      if (!current) throw new FixtureRepositoryError('NOT_FOUND', `linkMatch: no existe el partido del calendario ${fixtureId}`);
      const next = admit({ ...current, matchId, updatedAt }, 'linkMatch');
      commit((draft) => draft.set(fixtureId, next));
    },
  };
}
