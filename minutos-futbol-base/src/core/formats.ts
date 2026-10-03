/**
 * Formatos de juego. El formato es configuración, no código: el resto del
 * dominio solo conoce `playersOnField`, `periodsCount` y `periodDurationMs`.
 */
export type GameFormatId = 'F7' | 'F8' | 'F11';

export interface GameFormat {
  id: GameFormatId;
  label: string;
  playersOnField: number;
  defaultPeriodsCount: number;
  defaultPeriodDurationMs: number;
  maxSquadSize: number;
}

const MINUTE_MS = 60_000;

export const GAME_FORMATS: Record<GameFormatId, GameFormat> = {
  F7: {
    id: 'F7',
    label: 'Fútbol 7',
    playersOnField: 7,
    defaultPeriodsCount: 2,
    defaultPeriodDurationMs: 25 * MINUTE_MS,
    maxSquadSize: 14,
  },
  F8: {
    id: 'F8',
    label: 'Fútbol 8',
    playersOnField: 8,
    defaultPeriodsCount: 2,
    defaultPeriodDurationMs: 30 * MINUTE_MS,
    maxSquadSize: 16,
  },
  F11: {
    id: 'F11',
    label: 'Fútbol 11',
    playersOnField: 11,
    defaultPeriodsCount: 2,
    defaultPeriodDurationMs: 35 * MINUTE_MS,
    maxSquadSize: 18,
  },
};
