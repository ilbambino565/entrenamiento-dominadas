import type { FieldPosition, LineupEntry, MatchPlayerState, MatchState } from '../../core';

/**
 * Dibujos tácticos: atajos para colocar a los que ya están en el campo.
 *
 * Son solo posiciones de partida (el entrenador sigue moviendo fichas a mano):
 * no cambian quién juega ni los minutos. Los dígitos van de la defensa al
 * ataque y no cuentan al portero, que siempre va abajo en su área.
 */

export const GOALKEEPER_SLOT: FieldPosition = { x: 0.5, y: 0.9 };

/** Presets por jugadores en campo (portero incluido en la clave, no en los dígitos). */
export const FORMATION_PRESETS: Record<number, readonly string[]> = {
  7: ['2-3-1', '3-2-1', '3-1-2', '2-2-2', '1-3-2', '2-1-3'],
  8: ['3-3-1', '2-3-2', '3-2-2', '2-4-1', '3-1-3'],
  11: ['4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '3-4-3', '5-3-2'],
};

export function formationsFor(playersOnField: number): readonly string[] {
  return FORMATION_PRESETS[playersOnField] ?? [];
}

/** '3-2-1' → [3, 2, 1]; null si no son dígitos positivos separados por guiones. */
export function parseFormation(formation: string): number[] | null {
  if (!/^\d+(-\d+)*$/.test(formation)) return null;
  const rows = formation.split('-').map(Number);
  return rows.every((n) => n >= 1) ? rows : null;
}

export function isValidFormation(formation: string, playersOnField: number): boolean {
  const rows = parseFormation(formation);
  return rows !== null && rows.reduce((a, b) => a + b, 0) === playersOnField - 1;
}

// Filas entre la defensa (cerca del portero, y alta) y el ataque (y baja).
const DEFENCE_Y = 0.7;
const ATTACK_Y = 0.22;
const SINGLE_ROW_Y = 0.46;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Huecos de un dibujo: de la defensa al ataque y, en cada fila, de izquierda a
 * derecha. Los jugadores de una fila se reparten centrados; con tres o más la
 * fila ocupa de 0,2 a 0,8 del ancho.
 */
export function formationSlots(formation: string): FieldPosition[] {
  const rows = parseFormation(formation);
  if (!rows) return [];
  const slots: FieldPosition[] = [];
  rows.forEach((count, row) => {
    const y = rows.length === 1 ? SINGLE_ROW_Y : DEFENCE_Y - (row * (DEFENCE_Y - ATTACK_Y)) / (rows.length - 1);
    const spacing = count <= 2 ? 0.3 : 0.6 / (count - 1);
    for (let i = 0; i < count; i++) {
      slots.push({ x: round3(0.5 + (i - (count - 1) / 2) * spacing), y: round3(y) });
    }
  });
  return slots;
}

// Banda vertical en la que dos fichas cuentan como "la misma fila".
const ROW_BAND = 0.15;

function rowKey(p: MatchPlayerState): number {
  return Math.round((p.position?.y ?? 0.5) / ROW_BAND);
}

/** De abajo (defensa) arriba y, dentro de la fila, de izquierda a derecha. */
function byCurrentRowThenX(a: MatchPlayerState, b: MatchPlayerState): number {
  const rows = rowKey(b) - rowKey(a);
  if (rows !== 0) return rows;
  return (a.position?.x ?? 0.5) - (b.position?.x ?? 0.5);
}

/**
 * Reparte a los que YA están en el campo entre los huecos del dibujo: el
 * portero a su sitio y el resto en el mismo orden en que están ahora (de abajo
 * arriba, de izquierda a derecha), para que cada uno acabe cerca de donde
 * estaba. Si sobran jugadores respecto al dibujo, conservan su posición.
 */
export function applyFormation(state: MatchState, formation: string): LineupEntry[] {
  const onField = Object.values(state.players).filter((p) => p.location === 'FIELD');
  const keeper = onField.find((p) => p.isGoalkeeper) ?? null;
  const outfield = onField.filter((p) => p !== keeper).sort(byCurrentRowThenX);
  const slots = formationSlots(formation);

  const entries: LineupEntry[] = [];
  if (keeper) entries.push({ playerId: keeper.playerId, position: GOALKEEPER_SLOT, goalkeeper: true });
  outfield.forEach((p, i) => {
    entries.push({ playerId: p.playerId, position: slots[i] ?? p.position ?? { x: 0.5, y: 0.5 } });
  });
  return entries;
}

/** Solo las entradas cuya posición cambia: lo mínimo que hay que mover con el partido en marcha. */
export function changedPositions(state: MatchState, entries: readonly LineupEntry[]): LineupEntry[] {
  return entries.filter((e) => {
    const current = state.players[e.playerId]?.position;
    return !current || current.x !== e.position.x || current.y !== e.position.y;
  });
}
