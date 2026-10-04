import { SquadError, type MatchSetup, type SquadService, type SquadState } from '../../../app-services/squadService';
import {
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
} from '../../../core/squad';
import type { Player, PlayerDraft, Team, TeamDraft } from '../../../core/team';
import type { TeamPack } from '../../../core/teamPack';

/**
 * Doble de `SquadService` para los tests de pantalla: la misma interfaz
 * sobre arrays en memoria y las reglas de `core/squad.ts`, sin repositorio.
 * Los nombres de los datos de prueba son inventados (el repositorio es
 * público y los datos reales son de menores).
 */
export interface FakeSquadOptions {
  team?: Team | null;
  players?: readonly Player[];
  /** Arranca en 'loading' y no pasa a 'ready' hasta `finishLoad()`. */
  deferLoad?: boolean;
  now?: () => number;
}

export interface FakeSquadService extends SquadService {
  /** Ganchos de prueba: forzar estado (loading/error) y terminar una carga diferida. */
  setState(patch: Partial<SquadState>): void;
  finishLoad(): void;
}

const T0 = 1_700_000_000_000;

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'CD Prueba',
    category: null,
    federationName: null,
    defaultFormat: 'F7',
    defaultFormation: null,
    periodsCount: 2,
    periodDurationMs: 25 * 60_000,
    displayNameMode: 'full',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makePlayer(id: string, firstName: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 'team-1',
    firstName,
    lastName: null,
    shirtNumber: null,
    isGoalkeeper: false,
    isActive: true,
    photoUri: null,
    photoConsent: false,
    sortOrder: 0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

export function createFakeSquadService(options: FakeSquadOptions = {}): FakeSquadService {
  const now = options.now ?? (() => T0 + seq);
  let seq = 0;
  const team = options.team === undefined ? makeTeam() : options.team;
  const players = withSortOrders(sortPlayers(options.players ?? []), T0);
  // Con carga diferida, equipo y jugadores no se ven hasta `finishLoad()`, como en el servicio real.
  let state: SquadState = options.deferLoad
    ? { status: 'loading', error: null, team: null, players: [] }
    : { status: 'ready', error: null, team, players };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<SquadState>): void => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const requireTeam = (): Team => {
    if (!state.team) throw new SquadError('NO_TEAM', 'Primero crea el equipo');
    return state.team;
  };

  const requirePlayer = (id: string): Player => {
    const p = state.players.find((x) => x.id === id);
    if (!p) throw new SquadError('NOT_FOUND', 'Jugador no encontrado');
    return p;
  };

  const toDraft = (p: Player): PlayerDraft => ({
    firstName: p.firstName,
    lastName: p.lastName,
    shirtNumber: p.shirtNumber,
    isGoalkeeper: p.isGoalkeeper,
    isActive: p.isActive,
    photoUri: p.photoUri,
    photoConsent: p.photoConsent,
  });

  return {
    setState: set,
    finishLoad: () => set({ status: 'ready', team, players }),

    async load() {
      if (!options.deferLoad && state.status === 'loading') set({ status: 'ready' });
      return state;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async createTeam(draft: TeamDraft) {
      const at = now();
      const team: Team = { id: 'team-1', ...draft, createdAt: at, updatedAt: at };
      set({ team });
      return team;
    },
    async updateTeam(patch: Partial<TeamDraft>) {
      const team: Team = { ...requireTeam(), ...patch, updatedAt: now() };
      set({ team });
      return team;
    },

    async addPlayer(draft: PlayerDraft) {
      const team = requireTeam();
      const issues = validatePlayerDraft(draft, state.players);
      if (hasBlockingIssues(issues)) throw new SquadError('VALIDATION', 'La ficha tiene errores', issues);
      const at = now();
      seq += 1;
      const player: Player = {
        id: `p${seq}`,
        teamId: team.id,
        ...normalizePlayerDraft(draft),
        sortOrder: state.players.length,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      set({ players: [...state.players, player] });
      return player;
    },
    async updatePlayer(id: string, patch: Partial<PlayerDraft>) {
      const current = requirePlayer(id);
      const draft = { ...toDraft(current), ...patch };
      const issues = validatePlayerDraft(draft, state.players, id);
      if (hasBlockingIssues(issues)) throw new SquadError('VALIDATION', 'La ficha tiene errores', issues);
      const player: Player = { ...current, ...normalizePlayerDraft(draft), updatedAt: now() };
      set({ players: state.players.map((p) => (p.id === id ? player : p)) });
      return player;
    },
    async removePlayer(id: string) {
      const at = now();
      // Se anonimiza (como haría el servicio real al persistir) y desaparece de la lista; el resto se renumera.
      const removed = anonymizePlayer(requirePlayer(id), at);
      set({ players: withSortOrders(state.players.filter((p) => p.id !== removed.id), at) });
    },
    async movePlayer(id: string, direction: -1 | 1) {
      set({ players: movePlayerInList(state.players, id, direction, now()) });
    },
    async reorder(orderedIds: readonly string[]) {
      set({ players: reorderByIds(state.players, orderedIds, now()) });
    },
    async importTeamPack(pack: TeamPack) {
      if (state.players.length > 0) throw new SquadError('NOT_EMPTY', 'La plantilla no está vacía');
      void pack;
      throw new Error('importTeamPack no está implementado en el doble de pruebas');
    },

    matchSetup(): MatchSetup {
      const team = requireTeam();
      const config = teamMatchConfig(team);
      const active = activePlayers(state.players);
      const { lineup, bench } = buildDefaultLineup(team, state.players, config.playersOnField);
      const squad = active.map((p) => p.id);
      return {
        teamName: team.name,
        players: Object.fromEntries(active.map((p) => [p.id, toPlayerInfo(p, team.displayNameMode)])),
        squad,
        lineup,
        bench,
        config: { ...config, squad },
      };
    },
  };
}
