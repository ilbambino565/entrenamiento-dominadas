import { fixturesFromCalendar, mergeImportedFixtures, type Fixture } from '../../core/fixture';
import { parseRfafCalendar } from '../../core/rfafCalendar';
import type { Team } from '../../core/team';
import { uuidv7 } from '../../lib/uuid';
import type { Persistence } from './persistence';

/**
 * Importar el calendario pegado: lee los partidos del equipo con su nombre en
 * la federación y sustituye el calendario guardado, conservando lo ya jugado.
 * Si el texto no trae ningún partido del equipo NO se toca lo guardado (pegar
 * mal no puede borrar el calendario bueno).
 */
export type ImportCalendarErrorCode = 'NO_FEDERATION_NAME' | 'NO_MATCHES';

export class ImportCalendarError extends Error {
  readonly code: ImportCalendarErrorCode;

  constructor(code: ImportCalendarErrorCode, message: string) {
    super(message);
    this.name = 'ImportCalendarError';
    this.code = code;
  }
}

export interface ImportedCalendar {
  count: number;
  competition: string | null;
  season: string | null;
  fixtures: Fixture[];
}

export interface ImportCalendarInput {
  persistence: Persistence;
  team: Pick<Team, 'id' | 'federationName'>;
  text: string;
  now?: () => number;
  newId?: () => string;
}

export async function importCalendar(input: ImportCalendarInput): Promise<ImportedCalendar> {
  const { persistence, team, text } = input;
  const now = input.now ?? Date.now;
  const at = now();
  const newId = input.newId ?? (() => uuidv7(at));
  if (team.federationName === null) throw new ImportCalendarError('NO_FEDERATION_NAME', 'El equipo no tiene nombre en la federación');

  const calendar = parseRfafCalendar(text, team.federationName);
  if (calendar.fixtures.length === 0) throw new ImportCalendarError('NO_MATCHES', 'No se encontró ningún partido del equipo en el texto');

  const existing = await persistence.fixtures.listFixtures(team.id);
  const merged = mergeImportedFixtures(existing, fixturesFromCalendar(calendar, team.id, newId, at));
  await persistence.fixtures.replaceFixtures(team.id, merged);
  return { count: merged.length, competition: calendar.competition, season: calendar.season, fixtures: merged };
}
