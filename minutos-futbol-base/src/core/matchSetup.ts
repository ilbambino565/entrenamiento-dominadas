import type { HomeAway } from './match';
import type { Team } from './team';

/**
 * Datos del partido que se piden en P5 (docs/05 §5.3): rival, fecha, partes ×
 * minutos y, opcionales, local/visitante, competición y jornada. Dominio puro:
 * la fecha se escribe y se lee en hora local del dispositivo.
 */
export const OPPONENT_MAX_LENGTH = 60;
export const COMPETITION_MAX_LENGTH = 60;
export const MATCHDAY_MAX_LENGTH = 30;
export const PERIODS_COUNT_OPTIONS: readonly number[] = [1, 2, 3, 4];
export const PERIOD_MINUTES_MIN = 1;
export const PERIOD_MINUTES_MAX = 90;
const MINUTE_MS = 60_000;

export interface MatchSetupDraft {
  opponent: string;
  /** Epoch ms de la fecha y hora de inicio, o null si el texto escrito no es una fecha válida. */
  scheduledAt: number | null;
  periodsCount: number;
  /** Minutos por parte; null si el texto escrito no es válido. */
  periodMinutes: number | null;
  homeAway: HomeAway | null;
  competition: string;
  matchday: string;
}

/**
 * Lo que un partido del calendario adelanta a P5. Sin hora en la fuente
 * (`hasTime` false) la fecha va rellena y la hora queda vacía para que el
 * entrenador la ponga: no se inventa una hora que luego se guardaría.
 */
export interface MatchSetupPrefill {
  opponent: string;
  scheduledAt: number;
  hasTime: boolean;
  homeAway: HomeAway | null;
  competition: string;
  matchday: string;
}

export type MatchSetupField = 'opponent' | 'scheduledAt' | 'periodsCount' | 'periodMinutes' | 'competition' | 'matchday';

export interface MatchSetupIssue {
  field: MatchSetupField;
  message: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `dd/mm/aaaa` en hora local. */
export function formatDateText(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `hh:mm` en hora local. */
export function formatTimeText(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;

/** `sáb 27/09` en hora local: la fecha corta de la lista de partidos. */
export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/**
 * `dd/mm/aaaa` + `hh:mm` → epoch ms en hora local. Acepta `-` y `.` como
 * separador de fecha y `.` en la hora. Null si el formato no cuadra o la fecha
 * no existe (31/02, 25:00): `Date` las "corregiría" en silencio y se guardaría
 * otro día del que escribió el entrenador.
 */
export function parseDateTime(dateText: string, timeText: string): number | null {
  const date = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(dateText.trim());
  const time = /^(\d{1,2})[:.](\d{2})$/.exec(timeText.trim());
  if (!date || !time) return null;
  const [day, month, year, hour, minute] = [date[1], date[2], date[3], time[1], time[2]].map(Number) as [number, number, number, number, number];
  const result = new Date(year, month - 1, day, hour, minute);
  const exact =
    result.getFullYear() === year &&
    result.getMonth() === month - 1 &&
    result.getDate() === day &&
    result.getHours() === hour &&
    result.getMinutes() === minute;
  return exact ? result.getTime() : null;
}

/** Texto del campo Minutos → entero entre 1 y 90; null si no lo es. */
export function parseMinutes(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const minutes = Number(t);
  return minutes >= PERIOD_MINUTES_MIN && minutes <= PERIOD_MINUTES_MAX ? minutes : null;
}

/** Valores iniciales: los del equipo para partes y minutos, `now` como fecha y sin rival. */
export function defaultMatchSetup(team: Pick<Team, 'periodsCount' | 'periodDurationMs'>, now: number): MatchSetupDraft {
  return {
    opponent: '',
    scheduledAt: now,
    periodsCount: team.periodsCount,
    periodMinutes: Math.round(team.periodDurationMs / MINUTE_MS),
    homeAway: null,
    competition: '',
    matchday: '',
  };
}

/** Sin espacios sobrantes; competición y jornada se quedan como texto (vacío = no informado). */
export function normalizeMatchSetup(draft: MatchSetupDraft): MatchSetupDraft {
  return {
    ...draft,
    opponent: draft.opponent.trim(),
    competition: draft.competition.trim(),
    matchday: draft.matchday.trim(),
  };
}

/** Todos los problemas a la vez. Sin problemas, el borrador es válido para continuar. */
export function validateMatchSetup(draft: MatchSetupDraft): MatchSetupIssue[] {
  const d = normalizeMatchSetup(draft);
  const issues: MatchSetupIssue[] = [];
  if (d.opponent === '') issues.push({ field: 'opponent', message: 'El rival es obligatorio' });
  else if (d.opponent.length > OPPONENT_MAX_LENGTH) {
    issues.push({ field: 'opponent', message: `El rival admite como máximo ${OPPONENT_MAX_LENGTH} caracteres` });
  }
  if (d.scheduledAt === null) issues.push({ field: 'scheduledAt', message: 'Escribe una fecha (dd/mm/aaaa) y una hora (hh:mm) válidas' });
  if (!PERIODS_COUNT_OPTIONS.includes(d.periodsCount)) {
    issues.push({ field: 'periodsCount', message: 'Elige entre 1 y 4 partes' });
  }
  if (d.periodMinutes === null) {
    issues.push({ field: 'periodMinutes', message: `Los minutos por parte deben estar entre ${PERIOD_MINUTES_MIN} y ${PERIOD_MINUTES_MAX}` });
  }
  if (d.competition.length > COMPETITION_MAX_LENGTH) {
    issues.push({ field: 'competition', message: `La competición admite como máximo ${COMPETITION_MAX_LENGTH} caracteres` });
  }
  if (d.matchday.length > MATCHDAY_MAX_LENGTH) {
    issues.push({ field: 'matchday', message: `La jornada admite como máximo ${MATCHDAY_MAX_LENGTH} caracteres` });
  }
  return issues;
}
