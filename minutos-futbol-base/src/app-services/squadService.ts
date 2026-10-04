import { GAME_FORMATS, type LineupEntry, type MatchConfig } from '../core';
import type { Player, PlayerDraft, PlayerInfo, Team, TeamDraft } from '../core/team';
import {
  FIRST_NAME_MAX_LENGTH,
  SHIRT_NUMBER_MAX,
  activePlayers,
  anonymizePlayer,
  buildDefaultLineup,
  hasBlockingIssues,
  movePlayerInList,
  normalizePlayerDraft,
  reorderByIds,
  sortPlayers,
  teamMatchConfig,
  toPlayerInfo,
  validatePlayerDraft,
  withSortOrders,
  type PlayerIssue,
} from '../core/squad';
import type { TeamPack } from '../core/teamPack';
import type { SquadRepository } from '../db/squadRepository';
import { uuidv7 } from '../lib/uuid';

/**
 * Servicio de equipo y plantilla: fachada única para las pantallas P1-P4.
 * Mantiene el estado en memoria (almacén externo para React) y persiste cada
 * cambio en el repositorio ANTES de notificar; si la escritura falla, el
 * estado no cambia y la promesa rechaza con `SquadError`.
 */
export interface SquadState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  team: Team | null;
  /** Ordenados por `sortOrder`; sin eliminados; con inactivos. */
  players: Player[];
}

/** Todo lo que necesita la pantalla de partido con la plantilla actual. */
export interface MatchSetup {
  teamName: string;
  players: Record<string, PlayerInfo>;
  /** Convocados por defecto: los activos, en orden de plantilla. */
  squad: string[];
  lineup: LineupEntry[];
  bench: string[];
  config: Omit<MatchConfig, 'matchId'>;
}

export type SquadErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'NO_TEAM' | 'NOT_EMPTY' | 'STORAGE';

export class SquadError extends Error {
  readonly code: SquadErrorCode;
  readonly issues: readonly PlayerIssue[];
  override readonly cause?: unknown;

  constructor(code: SquadErrorCode, message: string, issues: readonly PlayerIssue[] = [], cause?: unknown) {
    super(message);
    this.name = 'SquadError';
    this.code = code;
    this.issues = issues;
    this.cause = cause;
  }
}

export interface SquadService {
  /** Carga equipo y plantilla del repositorio. Idempotente: la segunda llamada devuelve el estado actual. */
  load(): Promise<SquadState>;
  getState(): SquadState;
  subscribe(listener: () => void): () => void;
  createTeam(draft: TeamDraft): Promise<Team>;
  updateTeam(patch: Partial<TeamDraft>): Promise<Team>;
  /** Valida (`validatePlayerDraft`); los errores bloqueantes rechazan con `VALIDATION` e `issues`. Entra el último en el orden. */
  addPlayer(draft: PlayerDraft): Promise<Player>;
  updatePlayer(id: string, patch: Partial<PlayerDraft>): Promise<Player>;
  /** Anonimiza y marca eliminado; renumera `sortOrder` del resto. */
  removePlayer(id: string): Promise<void>;
  /** Sube (-1) o baja (+1) un puesto; en los extremos no hace nada. */
  movePlayer(id: string, direction: -1 | 1): Promise<void>;
  /** Orden completo; los ids que falten conservan su posición relativa al final. */
  reorder(orderedIds: readonly string[]): Promise<void>;
  /**
   * Importa un paquete de equipo (nombres, dorsales, portero, fotos, titulares
   * y dibujo) creando el equipo si no existe. Solo con la plantilla vacía
   * (si no, rechaza con `NOT_EMPTY`).
   */
  importTeamPack(pack: TeamPack): Promise<void>;
  /** Rechaza con `NO_TEAM` si no hay equipo. */
  matchSetup(): MatchSetup;
}

export interface SquadServiceDeps {
  repo: SquadRepository;
  now?: () => number;
  newId?: () => string;
}

// ───────────── Implementación ─────────────
//
// Mismas reglas que el MatchEngine (docs/01 §1.2, docs/03 §3.7):
// - ESCRIBIR ANTES DE MOSTRAR: el estado en memoria solo cambia cuando el
//   repositorio ha confirmado; cada cambio es un objeto nuevo (inmutable) y
//   se notifica justo después.
// - COLA SERIE: las escrituras se encadenan en una promesa compartida, así
//   dos toques rápidos (dos "subir") se aplican uno sobre el resultado del
//   otro y no se pisan.
// - La lógica (validar, ordenar, anonimizar, alinear) vive en `core/squad`;
//   aquí solo se compone, se persiste y se traduce el fallo a `SquadError`.

const INITIAL_STATE: SquadState = { status: 'loading', error: null, team: null, players: [] };

const causeMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const storageError = (what: string, cause: unknown): SquadError =>
  new SquadError('STORAGE', `No se pudo guardar ${what}: ${causeMessage(cause)}`, [], cause);

const noTeamError = (): SquadError =>
  new SquadError('NO_TEAM', 'Todavía no hay equipo: crea el equipo antes de gestionar la plantilla');

const validationError = (issues: readonly PlayerIssue[]): SquadError =>
  new SquadError(
    'VALIDATION',
    issues
      .filter((i) => i.level === 'error')
      .map((i) => i.message)
      .join('. '),
    issues,
  );

/** Quita las claves con `undefined`: un `Partial` que las traiga no debe pisar lo guardado. */
function definedPatch<T extends object>(patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

const toPlayerDraft = (p: Player): PlayerDraft => ({
  firstName: p.firstName,
  lastName: p.lastName,
  shirtNumber: p.shirtNumber,
  isGoalkeeper: p.isGoalkeeper,
  isActive: p.isActive,
  photoUri: p.photoUri,
  photoConsent: p.photoConsent,
});

const toTeamDraft = (t: Team): TeamDraft => ({
  name: t.name,
  category: t.category,
  federationName: t.federationName,
  defaultFormat: t.defaultFormat,
  defaultFormation: t.defaultFormation,
  periodsCount: t.periodsCount,
  periodDurationMs: t.periodDurationMs,
  displayNameMode: t.displayNameMode,
});

/** Nombre, categoría y nombre en la federación sin espacios sobrantes; los vacíos → null. El nombre es obligatorio. */
function cleanTeamDraft(draft: TeamDraft): TeamDraft {
  const name = draft.name.trim();
  const category = (draft.category ?? '').trim();
  const federationName = (draft.federationName ?? '').trim().replace(/\s+/g, ' ');
  if (name === '') throw new SquadError('VALIDATION', 'El nombre del equipo es obligatorio');
  return { ...draft, name, category: category === '' ? null : category, federationName: federationName === '' ? null : federationName };
}

/** Borrador normalizado y validado contra la plantilla; los errores bloqueantes rechazan sin tocar el repositorio. */
function cleanPlayerDraft(draft: PlayerDraft, players: readonly Player[], selfId?: string): PlayerDraft {
  const clean = normalizePlayerDraft(draft);
  const issues = validatePlayerDraft(clean, players, selfId);
  if (hasBlockingIssues(issues)) throw validationError(issues);
  return clean;
}

/** Dorsal del paquete: 0 significa "sin dorsal" (y lo que no sea un dorsal válido, tampoco). */
const packShirtNumber = (n: number): number | null => (Number.isInteger(n) && n >= 1 && n <= SHIRT_NUMBER_MAX ? n : null);

/** Titulares primero, en su orden, y después el resto en el orden del paquete (ids desconocidos o repetidos se ignoran). */
function orderPackPlayers(pack: TeamPack): PlayerInfo[] {
  const byId = new Map(pack.players.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const head: PlayerInfo[] = [];
  for (const id of pack.starters ?? []) {
    const p = byId.get(id);
    if (p && !placed.has(id)) {
      placed.add(id);
      head.push(p);
    }
  }
  return [...head, ...pack.players.filter((p) => !placed.has(p.id))];
}

function packPlayerDraft(info: PlayerInfo): PlayerDraft {
  return normalizePlayerDraft({
    // Misma regla que la ficha tecleada: un nombre más largo bloquearía después cualquier edición.
    firstName: info.name.trim().slice(0, FIRST_NAME_MAX_LENGTH),
    lastName: null,
    shirtNumber: packShirtNumber(info.number),
    isGoalkeeper: info.isGoalkeeper === true,
    isActive: true,
    photoUri: info.photoUri ?? null,
    // La foto sale del archivo privado del propio entrenador: importarla es su consentimiento.
    photoConsent: Boolean(info.photoUri),
  });
}

export function createSquadService(deps: SquadServiceDeps): SquadService {
  const { repo } = deps;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => uuidv7(now()));

  let state: SquadState = INITIAL_STATE;
  let loaded = false;
  let loading: Promise<SquadState> | null = null;
  const listeners = new Set<() => void>();

  // ───────────── Estado y suscriptores ─────────────

  function notify(): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        // Un suscriptor roto no puede impedir que el resto vea el estado persistido.
        console.error('[SquadService] error en un suscriptor', error);
      }
    }
  }

  /** Único punto que cambia el estado: siempre un objeto nuevo y siempre notifica. */
  function setState(patch: Partial<SquadState>): void {
    state = { ...state, ...patch };
    notify();
  }

  // ───────────── Carga ─────────────

  async function readAll(): Promise<SquadState> {
    if (state.status !== 'loading') setState({ status: 'loading', error: null });
    try {
      const team = await repo.getTeam();
      // El repositorio ya ordena; se reordena por si otra implementación no lo hiciera.
      const players = team ? sortPlayers(await repo.listPlayers(team.id)) : [];
      loaded = true;
      setState({ status: 'ready', error: null, team, players });
      return state;
    } catch (error) {
      const message = 'No se pudo cargar el equipo y la plantilla';
      setState({ status: 'error', error: message });
      throw new SquadError('STORAGE', `${message}: ${causeMessage(error)}`, [], error);
    }
  }

  /**
   * Comparte la lectura en vuelo (dos pantallas que cargan a la vez leen una
   * sola vez) y, una vez cargado, devuelve el estado sin tocar el repositorio.
   * Tras un fallo se puede volver a llamar: reintenta.
   */
  function ensureLoaded(): Promise<SquadState> {
    if (loaded) return Promise.resolve(state);
    if (!loading) {
      loading = readAll().finally(() => {
        loading = null;
      });
    }
    return loading;
  }

  // ───────────── Cola serie y commit ─────────────

  // La cadena nunca queda rechazada: una escritura fallida no bloquea a la siguiente.
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Toda escritura espera a las anteriores y parte del estado cargado (lo carga si hiciera falta). */
  function write<T>(task: () => Promise<T>): Promise<T> {
    return serialize(async () => {
      await ensureLoaded();
      return task();
    });
  }

  /** Escribir antes de mostrar: el estado solo cambia cuando `persist` ha terminado bien. */
  async function commit(
    what: string,
    persist: () => Promise<void>,
    next: Partial<Pick<SquadState, 'team' | 'players'>>,
  ): Promise<void> {
    try {
      await persist();
    } catch (error) {
      throw storageError(what, error);
    }
    setState({ status: 'ready', error: null, ...next });
  }

  function requireTeam(): Team {
    if (!state.team) throw noTeamError();
    return state.team;
  }

  function findPlayer(id: string): Player {
    const player = state.players.find((p) => p.id === id);
    if (!player) throw new SquadError('NOT_FOUND', `No se encuentra el jugador (id=${id})`);
    return player;
  }

  /** Filas que `core/squad` sustituyó por una nueva (las que cambian de `sortOrder`); las demás son el mismo objeto. */
  function changedRows(next: readonly Player[]): Player[] {
    const current = new Set<Player>(state.players);
    return next.filter((p) => !current.has(p));
  }

  /** Persiste solo las filas que cambian de orden; si no cambia ninguna, no toca el repositorio ni notifica. */
  async function commitOrder(next: readonly Player[]): Promise<void> {
    const changed = changedRows(next);
    if (changed.length === 0) return;
    await commit('el orden de la plantilla', () => repo.savePlayers(changed), { players: [...next] });
  }

  // ───────────── Equipo ─────────────

  function createTeam(draft: TeamDraft): Promise<Team> {
    return write(async () => {
      const clean = cleanTeamDraft(draft);
      const at = now();
      const existing = state.team;
      // El MVP tiene un único equipo: crearlo de nuevo lo sustituye sin cambiar de identidad.
      const team: Team = existing
        ? { ...existing, ...clean, updatedAt: at }
        : { id: newId(), ...clean, createdAt: at, updatedAt: at };
      await commit('el equipo', () => repo.saveTeam(team), { team });
      return team;
    });
  }

  function updateTeam(patch: Partial<TeamDraft>): Promise<Team> {
    return write(async () => {
      const current = requireTeam();
      const clean = cleanTeamDraft({ ...toTeamDraft(current), ...definedPatch(patch) });
      const team: Team = { ...current, ...clean, updatedAt: now() };
      await commit('el equipo', () => repo.saveTeam(team), { team });
      return team;
    });
  }

  // ───────────── Jugadores ─────────────

  function addPlayer(draft: PlayerDraft): Promise<Player> {
    return write(async () => {
      const team = requireTeam();
      const clean = cleanPlayerDraft(draft, state.players);
      const at = now();
      const player: Player = {
        id: newId(),
        teamId: team.id,
        ...clean,
        sortOrder: state.players.length,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      await commit('el jugador', () => repo.savePlayer(player), { players: [...state.players, player] });
      return player;
    });
  }

  function updatePlayer(id: string, patch: Partial<PlayerDraft>): Promise<Player> {
    return write(async () => {
      const current = findPlayer(id);
      const clean = cleanPlayerDraft({ ...toPlayerDraft(current), ...definedPatch(patch) }, state.players, id);
      const player: Player = { ...current, ...clean, updatedAt: now() };
      await commit('el jugador', () => repo.savePlayer(player), {
        players: state.players.map((p) => (p.id === id ? player : p)),
      });
      return player;
    });
  }

  function removePlayer(id: string): Promise<void> {
    return write(async () => {
      const target = findPlayer(id);
      const at = now();
      const removed = anonymizePlayer(target, at);
      const rest = withSortOrders(
        state.players.filter((p) => p.id !== id),
        at,
      );
      // Una sola transacción: el eliminado y los que bajan un puesto.
      await commit('la baja del jugador', () => repo.savePlayers([removed, ...changedRows(rest)]), { players: rest });
    });
  }

  const movePlayer = (id: string, direction: -1 | 1): Promise<void> =>
    write(() => commitOrder(movePlayerInList(state.players, id, direction, now())));

  const reorder = (orderedIds: readonly string[]): Promise<void> =>
    write(() => commitOrder(reorderByIds(state.players, orderedIds, now())));

  // ───────────── Paquete de equipo ─────────────

  /**
   * Equipo que recibe el paquete: se crea si no existe (F7 por defecto, modo
   * de nombre 'first' porque el paquete solo trae nombres de pila) y, si ya
   * existe sin dibujo, toma el del paquete. Se guarda ANTES que los jugadores
   * (clave foránea en SQLite).
   */
  async function importedTeam(pack: TeamPack, at: number): Promise<Team> {
    const existing = state.team;
    let team: Team;
    if (!existing) {
      const f7 = GAME_FORMATS.F7;
      team = {
        id: newId(),
        name: pack.teamName,
        category: null,
        federationName: null,
        defaultFormat: 'F7',
        defaultFormation: pack.formation ?? null,
        periodsCount: f7.defaultPeriodsCount,
        periodDurationMs: f7.defaultPeriodDurationMs,
        displayNameMode: 'first',
        createdAt: at,
        updatedAt: at,
      };
    } else if (pack.formation && existing.defaultFormation === null) {
      team = { ...existing, defaultFormation: pack.formation, updatedAt: at };
    } else {
      return existing;
    }
    await commit('el equipo', () => repo.saveTeam(team), { team });
    return team;
  }

  function importTeamPack(pack: TeamPack): Promise<void> {
    return write(async () => {
      if (state.players.length > 0) {
        throw new SquadError('NOT_EMPTY', 'La plantilla ya tiene jugadores: el paquete solo se importa con la plantilla vacía');
      }
      const at = now();
      const team = await importedTeam(pack, at);
      const players = orderPackPlayers(pack).map(
        (info, i): Player => ({
          id: newId(),
          teamId: team.id,
          ...packPlayerDraft(info),
          sortOrder: i,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        }),
      );
      await commit('la plantilla importada', () => repo.savePlayers(players), { players });
    });
  }

  // ───────────── Paso al partido ─────────────

  function matchSetup(): MatchSetup {
    const team = requireTeam();
    const active = activePlayers(state.players);
    const players: Record<string, PlayerInfo> = {};
    for (const p of active) players[p.id] = toPlayerInfo(p, team.displayNameMode);
    const squad = active.map((p) => p.id);
    const base = teamMatchConfig(team);
    const { lineup, bench } = buildDefaultLineup(team, state.players, base.playersOnField);
    return { teamName: team.name, players, squad, lineup, bench, config: { ...base, squad } };
  }

  // ───────────── API ─────────────

  return {
    load: ensureLoaded,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    createTeam,
    updateTeam,
    addPlayer,
    updatePlayer,
    removePlayer,
    movePlayer,
    reorder,
    importTeamPack,
    matchSetup,
  };
}
