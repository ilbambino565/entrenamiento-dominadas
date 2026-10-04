import type { LineupEntry } from '../../core';
import type { PlayerInfo } from './demoTeam';
import { GOALKEEPER_SLOT, formationSlots, isValidFormation, parseFormation } from './formations';

/**
 * "Paquete de equipo": plantilla real inyectada desde fuera del repositorio.
 *
 * El repositorio es público y los datos de los niños no pueden entrar en él.
 * Hasta que exista la pantalla de Plantilla (con SQLite y fotos de la galería),
 * la versión web privada carga `globalThis.__TEAM_PACK__` con nombres, dorsales
 * y fotos (data URIs) desde un archivo que solo vive junto a esa página.
 * Si no hay paquete, la app usa el equipo de prueba.
 */
export interface TeamPack {
  teamName: string;
  players: PlayerInfo[];
  /** Titulares en orden, sin repetidos (el portero puede ir en cualquier posición). Por defecto los primeros. */
  starters?: string[];
  /**
   * Dibujo de los titulares de campo ('3-1-2'…): los titulares se reparten por
   * filas de la defensa al ataque y, en cada fila, de izquierda a derecha
   * mirando hacia la portería rival. Si no cuadra con el formato se usa el de
   * referencia (2-3-1 en F7, 3-3-1 en F8, 4-4-2 en F11).
   */
  formation?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parsePlayer(raw: unknown): PlayerInfo | null {
  if (!isRecord(raw)) return null;
  const { id, name, number, isGoalkeeper, photoUri } = raw;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) return null;
  const player: PlayerInfo = { id, name, number: typeof number === 'number' && Number.isFinite(number) ? number : 0 };
  if (isGoalkeeper === true) player.isGoalkeeper = true;
  if (typeof photoUri === 'string' && photoUri) player.photoUri = photoUri;
  return player;
}

/** Valida el paquete; lo que no se entiende se descarta sin tirar el resto. */
export function parseTeamPack(source: unknown): TeamPack | null {
  if (!isRecord(source) || !Array.isArray(source.players)) return null;
  const players = source.players.map(parsePlayer).filter((p): p is PlayerInfo => p !== null);
  const ids = new Set(players.map((p) => p.id));
  if (players.length === 0 || ids.size !== players.length) return null;
  const pack: TeamPack = {
    teamName: typeof source.teamName === 'string' && source.teamName ? source.teamName : 'Mi equipo',
    players,
  };
  if (Array.isArray(source.starters)) {
    // Un id repetido (errata en un archivo escrito a mano) tiraría la alineación
    // entera en el motor: se conserva la primera aparición.
    pack.starters = source.starters
      .filter((id): id is string => typeof id === 'string' && ids.has(id))
      .filter((id, i, all) => all.indexOf(id) === i);
  }
  if (typeof source.formation === 'string' && parseFormation(source.formation)) pack.formation = source.formation;
  return pack;
}

export function readTeamPack(): TeamPack | null {
  return parseTeamPack((globalThis as { __TEAM_PACK__?: unknown }).__TEAM_PACK__);
}

export interface ResolvedLineup {
  lineup: LineupEntry[];
  bench: string[];
}

const DEFAULT_FORMATION: Record<number, string> = { 7: '2-3-1', 8: '3-3-1', 11: '4-4-2' };

/**
 * Titulares colocados en el dibujo del paquete (o el de referencia del formato)
 * con el portero (si lo hay) en su área; si no hay portero declarado, el último
 * titular ocupa ese hueco sin la marca.
 */
export function packLineup(pack: TeamPack, playersOnField: number): ResolvedLineup {
  const ids = pack.players.map((p) => p.id);
  const starters = (pack.starters && pack.starters.length > 0 ? pack.starters : ids).slice(0, playersOnField);
  const keeperId = starters.find((id) => pack.players.find((p) => p.id === id)?.isGoalkeeper) ?? null;
  const outfield = starters.filter((id) => id !== keeperId);
  const fallback = DEFAULT_FORMATION[playersOnField] ?? '4-4-2';
  const formation = pack.formation && isValidFormation(pack.formation, playersOnField) ? pack.formation : fallback;
  const slots = formationSlots(formation);

  const lineup: LineupEntry[] = [];
  if (keeperId) lineup.push({ playerId: keeperId, position: GOALKEEPER_SLOT, goalkeeper: true });
  outfield.forEach((playerId, i) => {
    lineup.push({ playerId, position: slots[i] ?? GOALKEEPER_SLOT });
  });
  const bench = ids.filter((id) => !starters.includes(id));
  return { lineup, bench };
}
