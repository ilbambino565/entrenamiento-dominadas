import { activePlayers } from './squad';
import type { Player } from './team';

/**
 * Convocatoria de un partido (P6, docs/05 §5.3). Se elige entre los jugadores
 * activos y no eliminados, en orden de plantilla; por defecto van todos
 * (lo habitual es desmarcar uno o dos). Dominio puro.
 */

/** Los que se pueden convocar, en orden de plantilla. */
export const convocablePlayers = activePlayers;

/** Ids de todos los convocables: la selección inicial. */
export function defaultConvocation(players: readonly Player[]): string[] {
  return convocablePlayers(players).map((p) => p.id);
}

/** Marca o desmarca un jugador. Devuelve una selección nueva en el orden de la plantilla (nunca ids que no se puedan convocar). */
export function toggleConvocation(players: readonly Player[], selected: readonly string[], playerId: string): string[] {
  const next = new Set(selected);
  if (next.has(playerId)) next.delete(playerId);
  else next.add(playerId);
  return keepConvocable(players, next);
}

/** Selección ordenada como la plantilla y sin ids desconocidos, inactivos o eliminados. */
export function keepConvocable(players: readonly Player[], selected: Iterable<string>): string[] {
  const chosen = new Set(selected);
  return convocablePlayers(players)
    .filter((p) => chosen.has(p.id))
    .map((p) => p.id);
}

export type ConvocationIssue = { level: 'error' | 'warning'; message: string };

/**
 * Sin nadie convocado no hay partido (error). Con menos convocados que
 * jugadores en campo se puede seguir, pero el campo quedará con huecos (aviso).
 */
export function validateConvocation(selectedCount: number, playersOnField: number): ConvocationIssue | null {
  if (selectedCount === 0) return { level: 'error', message: 'Convoca al menos a un jugador' };
  if (selectedCount < playersOnField) {
    const missing = playersOnField - selectedCount;
    return { level: 'warning', message: `Con ${selectedCount} jugadores faltan ${missing} para completar el campo de ${playersOnField}` };
  }
  return null;
}
