import type { LineupEntry } from './events';
import { GAME_FORMATS } from './formats';
import { GOALKEEPER_SLOT, formationSlots, formationsFor, isValidFormation } from './formations';
import type { DisplayNameMode, Player, PlayerDraft, PlayerInfo, Team } from './team';

/**
 * Lógica pura de la plantilla (hito M3, pantallas P2-P4 y paso a P7/P8).
 *
 * Aquí viven las reglas que no dependen de dónde se guardan los datos ni de
 * cómo se pintan: validar la ficha de un jugador, resolver el nombre que se
 * muestra según el modo de privacidad, ordenar y reordenar la plantilla,
 * anonimizar al eliminar (RGPD, docs/01 §1.4) y construir la alineación por
 * defecto a partir de la plantilla y el dibujo del equipo. El servicio
 * (`app-services/squadService.ts`) persiste; la UI solo muestra.
 *
 * Todas las funciones son deterministas: el reloj (`updatedAt`, `at`) llega
 * como parámetro y las listas de entrada no se modifican nunca.
 */

export const FIRST_NAME_MAX_LENGTH = 40;
export const LAST_NAME_MAX_LENGTH = 60;
export const SHIRT_NUMBER_MIN = 0;
export const SHIRT_NUMBER_MAX = 99;

/** Nombre que recibe un jugador eliminado: su histórico sigue en la timeline, sin datos personales. */
export const DELETED_PLAYER_NAME = 'Jugador eliminado';

export type PlayerIssueField = 'firstName' | 'lastName' | 'shirtNumber' | 'photo';
export type PlayerIssueCode = 'REQUIRED' | 'TOO_LONG' | 'RANGE' | 'DUPLICATE_NUMBER' | 'PHOTO_WITHOUT_CONSENT';

/** Problema de una ficha. `error` impide guardar; `warning` se muestra y el entrenador decide. */
export interface PlayerIssue {
  field: PlayerIssueField;
  code: PlayerIssueCode;
  level: 'error' | 'warning';
  /** Texto en español, listo para la pantalla. */
  message: string;
}

const trimmed = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * Deja el borrador tal y como se guarda: nombre y apellidos sin espacios
 * sobrantes, apellidos vacíos → null y dorsal no numérico (NaN, el campo de
 * texto vacío) → null. El resto de campos no cambia.
 */
export function normalizePlayerDraft(draft: PlayerDraft): PlayerDraft {
  const lastName = trimmed(draft.lastName);
  return {
    ...draft,
    firstName: trimmed(draft.firstName),
    lastName: lastName === '' ? null : lastName,
    shirtNumber: draft.shirtNumber === null || Number.isNaN(draft.shirtNumber) ? null : draft.shirtNumber,
  };
}

const isShirtNumberInRange = (n: number): boolean => Number.isInteger(n) && n >= SHIRT_NUMBER_MIN && n <= SHIRT_NUMBER_MAX;

/**
 * Valida el borrador (ya normalizado por dentro, así da igual el orden en que
 * lo llame el servicio). Devuelve todos los problemas a la vez para que la
 * ficha los muestre junto a cada campo:
 * - nombre obligatorio y ≤ 40 caracteres; apellidos ≤ 60;
 * - dorsal vacío o entero entre 0 y 99;
 * - dorsal repetido con otro jugador no eliminado (distinto de `selfId` al
 *   editar): aviso, no error; en fútbol base pasa y se permite guardar;
 * - foto sin consentimiento: error (nunca se guarda una foto sin él).
 */
export function validatePlayerDraft(
  draft: PlayerDraft,
  others: readonly Pick<Player, 'id' | 'shirtNumber' | 'deletedAt'>[],
  selfId?: string,
): PlayerIssue[] {
  const d = normalizePlayerDraft(draft);
  const issues: PlayerIssue[] = [];

  if (d.firstName === '') {
    issues.push({ field: 'firstName', code: 'REQUIRED', level: 'error', message: 'El nombre es obligatorio' });
  } else if (d.firstName.length > FIRST_NAME_MAX_LENGTH) {
    issues.push({
      field: 'firstName',
      code: 'TOO_LONG',
      level: 'error',
      message: `El nombre no puede tener más de ${FIRST_NAME_MAX_LENGTH} caracteres`,
    });
  }

  if (d.lastName !== null && d.lastName.length > LAST_NAME_MAX_LENGTH) {
    issues.push({
      field: 'lastName',
      code: 'TOO_LONG',
      level: 'error',
      message: `Los apellidos no pueden tener más de ${LAST_NAME_MAX_LENGTH} caracteres`,
    });
  }

  if (d.shirtNumber !== null) {
    if (!isShirtNumberInRange(d.shirtNumber)) {
      issues.push({
        field: 'shirtNumber',
        code: 'RANGE',
        level: 'error',
        message: `El dorsal debe ser un número entero entre ${SHIRT_NUMBER_MIN} y ${SHIRT_NUMBER_MAX}`,
      });
    } else if (others.some((o) => o.id !== selfId && o.deletedAt === null && o.shirtNumber === d.shirtNumber)) {
      issues.push({
        field: 'shirtNumber',
        code: 'DUPLICATE_NUMBER',
        level: 'warning',
        message: `Ya hay otro jugador con el dorsal ${d.shirtNumber}`,
      });
    }
  }

  if (d.photoUri && !d.photoConsent) {
    issues.push({
      field: 'photo',
      code: 'PHOTO_WITHOUT_CONSENT',
      level: 'error',
      message: 'Para guardar la foto hace falta el consentimiento de la familia',
    });
  }

  return issues;
}

/** true si hay algún `error` (los avisos no bloquean el guardado). */
export const hasBlockingIssues = (issues: readonly PlayerIssue[]): boolean => issues.some((i) => i.level === 'error');

/**
 * Nombre a mostrar según el modo de privacidad del equipo (docs/01 §1.4):
 * 'full' = nombre y apellidos; 'first_initial' = nombre e inicial del primer
 * apellido con punto ("Ana G.", y "Ana D." para "de la Torre"); 'first' =
 * solo el nombre. Sin apellidos, los tres modos dan el nombre.
 */
export function displayName(p: Pick<Player, 'firstName' | 'lastName'>, mode: DisplayNameMode): string {
  const first = trimmed(p.firstName);
  const last = trimmed(p.lastName);
  if (mode === 'first' || last === '') return first;
  if (mode === 'full') return `${first} ${last}`;
  const initial = last.charAt(0).toUpperCase();
  return `${first} ${initial}.`;
}

/** Orden estable de la plantilla: `sortOrder`, luego `createdAt`, luego `id`. No modifica la entrada. */
export function sortPlayers(players: readonly Player[]): Player[] {
  return [...players].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Renumera `sortOrder` 0..n-1 en el orden dado. Los jugadores cuyo número no
 * cambia se devuelven como el mismo objeto (sin tocar `updatedAt`), así el
 * servicio sabe exactamente qué filas tiene que escribir.
 */
export function withSortOrders(players: readonly Player[], updatedAt: number): Player[] {
  return players.map((p, i) => (p.sortOrder === i ? p : { ...p, sortOrder: i, updatedAt }));
}

/**
 * Sube (-1) o baja (+1) un jugador intercambiándolo con su vecino y renumera.
 * En los extremos, o si el id no está, devuelve la lista sin cambios (copia).
 */
export function movePlayerInList(players: readonly Player[], id: string, direction: -1 | 1, updatedAt: number): Player[] {
  const from = players.findIndex((p) => p.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= players.length) return [...players];
  const next = [...players];
  const moved = next[from];
  const neighbour = next[to];
  if (!moved || !neighbour) return [...players];
  next[from] = neighbour;
  next[to] = moved;
  return withSortOrders(next, updatedAt);
}

/**
 * Orden completo tras un arrastre: primero los ids dados en ese orden (se
 * ignoran los desconocidos y los repetidos), después los que falten
 * conservando su orden relativo. Renumera.
 */
export function reorderByIds(players: readonly Player[], orderedIds: readonly string[], updatedAt: number): Player[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const head: Player[] = [];
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (p && !placed.has(id)) {
      placed.add(id);
      head.push(p);
    }
  }
  const tail = players.filter((p) => !placed.has(p.id));
  return withSortOrders([...head, ...tail], updatedAt);
}

/**
 * Derecho de supresión: se borran nombre, dorsal y foto y el jugador queda
 * marcado como eliminado e inactivo. Su id se conserva para que los minutos
 * de partidos pasados sigan cuadrando.
 */
export function anonymizePlayer(p: Player, at: number): Player {
  return {
    ...p,
    firstName: DELETED_PLAYER_NAME,
    lastName: null,
    shirtNumber: null,
    photoUri: null,
    photoConsent: false,
    isActive: false,
    updatedAt: at,
    deletedAt: at,
  };
}

/** Ficha para las pantallas de partido: nombre ya resuelto, dorsal (0 si no tiene) y solo las marcas presentes. */
export function toPlayerInfo(p: Player, mode: DisplayNameMode): PlayerInfo {
  const info: PlayerInfo = { id: p.id, name: displayName(p, mode), number: p.shirtNumber ?? 0 };
  if (p.isGoalkeeper) info.isGoalkeeper = true;
  if (p.photoUri) info.photoUri = p.photoUri;
  return info;
}

/** Los que cuentan para convocar y para los titulares por defecto: no eliminados y activos, en orden de plantilla. */
export function activePlayers(players: readonly Player[]): Player[] {
  return sortPlayers(players.filter((p) => p.deletedAt === null && p.isActive));
}

const REFERENCE_FORMATION: Record<number, string> = { 7: '2-3-1', 8: '3-3-1', 11: '4-4-2' };

/**
 * Dibujo de referencia para un número de jugadores en campo: 2-3-1 (7),
 * 3-3-1 (8) y 4-4-2 (11); para otros valores, el primer preset si lo hay y,
 * si no, 4-4-2 (sobran huecos, nunca faltan para plantillas pequeñas).
 */
export function defaultFormationFor(playersOnField: number): string {
  return REFERENCE_FORMATION[playersOnField] ?? formationsFor(playersOnField)[0] ?? '4-4-2';
}

/** Lo mínimo que hace falta de un titular para colocarlo: su id y si es portero. */
export type LineupCandidate = Pick<PlayerInfo, 'id' | 'isGoalkeeper'>;

/**
 * Coloca a los titulares dados: el primer portero a `GOALKEEPER_SLOT` con la
 * marca `goalkeeper` y el resto, en su orden, en los huecos del dibujo (de la
 * defensa al ataque, de izquierda a derecha). Sin portero declarado, quien
 * se quede sin hueco (el último) ocupa la portería sin la marca. Misma regla
 * para la plantilla real y para el paquete de equipo.
 */
export function placeStarters(starters: readonly LineupCandidate[], formation: string): LineupEntry[] {
  const keeper = starters.find((s) => s.isGoalkeeper === true) ?? null;
  const outfield = starters.filter((s) => s !== keeper);
  const slots = formationSlots(formation);
  const lineup: LineupEntry[] = [];
  if (keeper) lineup.push({ playerId: keeper.id, position: GOALKEEPER_SLOT, goalkeeper: true });
  outfield.forEach((s, i) => {
    lineup.push({ playerId: s.id, position: slots[i] ?? GOALKEEPER_SLOT });
  });
  return lineup;
}

/** Los primeros N activos; si no incluyen portero y hay uno más abajo, ese portero entra por el N-ésimo. */
function pickStarters(active: readonly Player[], playersOnField: number): Player[] {
  const starters = active.slice(0, playersOnField);
  if (playersOnField < 1 || starters.some((p) => p.isGoalkeeper)) return starters;
  const keeper = active.slice(playersOnField).find((p) => p.isGoalkeeper);
  return keeper ? [...starters.slice(0, playersOnField - 1), keeper] : starters;
}

/**
 * Alineación por defecto al crear un partido (P7): titulares = los primeros
 * N activos en orden de plantilla, con la salvedad del portero (si el único
 * portero activo está más abajo, sustituye al N-ésimo). Dibujo: el del
 * equipo si cuadra con el formato; si no, el de referencia. Banquillo: el
 * resto de activos en orden. Con menos activos que N, todos al campo.
 */
export function buildDefaultLineup(
  team: Pick<Team, 'defaultFormation'>,
  players: readonly Player[],
  playersOnField: number,
): { lineup: LineupEntry[]; bench: string[] } {
  const active = activePlayers(players);
  const starters = pickStarters(active, playersOnField);
  const starterIds = new Set(starters.map((p) => p.id));
  const formation =
    team.defaultFormation !== null && isValidFormation(team.defaultFormation, playersOnField)
      ? team.defaultFormation
      : defaultFormationFor(playersOnField);
  return {
    lineup: placeStarters(starters, formation),
    bench: active.filter((p) => !starterIds.has(p.id)).map((p) => p.id),
  };
}

/** Configuración de partido que sale del equipo: jugadores en campo según el formato, partes y duración. */
export function teamMatchConfig(team: Pick<Team, 'defaultFormat' | 'periodsCount' | 'periodDurationMs'>): {
  playersOnField: number;
  periodsCount: number;
  periodDurationMs: number;
} {
  return {
    playersOnField: GAME_FORMATS[team.defaultFormat].playersOnField,
    periodsCount: team.periodsCount,
    periodDurationMs: team.periodDurationMs,
  };
}
