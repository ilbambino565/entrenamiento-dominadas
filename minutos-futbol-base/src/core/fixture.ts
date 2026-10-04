import type { HomeAway } from './match';
import type { RfafCalendar } from './rfafCalendar';

/**
 * Partido del calendario de la federación guardado en la app (los del equipo,
 * no los de los demás clubes). Es lo que "Próximos partidos" ofrece al entrenador
 * para rellenar P5. Dominio puro.
 */
export interface Fixture {
  id: string;
  teamId: string;
  matchday: number;
  /** Fecha de la jornada (epoch ms, 00:00 local), o null si no se pudo leer. */
  matchdayDate: number | null;
  opponent: string;
  homeAway: HomeAway;
  venue: string | null;
  /** Fecha del partido; sin hora en la fuente (`hasTime` false) es las 00:00 y el entrenador la pone. */
  scheduledAt: number;
  hasTime: boolean;
  competition: string | null;
  season: string | null;
  /** Partido creado a partir de este calendario (al jugarlo); null si aún no se ha jugado. */
  matchId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Los partidos leídos del texto pegado, ya como filas del equipo (sin vínculo con ningún partido). */
export function fixturesFromCalendar(calendar: RfafCalendar, teamId: string, newId: () => string, now: number): Fixture[] {
  return calendar.fixtures.map((f) => ({
    id: newId(),
    teamId,
    matchday: f.matchday,
    matchdayDate: f.matchdayDate,
    opponent: f.opponent,
    homeAway: f.homeAway,
    venue: f.venue,
    scheduledAt: f.scheduledAt,
    hasTime: f.hasTime,
    competition: calendar.competition,
    season: calendar.season,
    matchId: null,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Reimportar sustituye el calendario, pero lo ya jugado no se pierde: un
 * partido nuevo hereda el vínculo con el partido guardado (y la hora que el
 * entrenador pudo haber fijado) del anterior de la misma jornada. Hay un
 * partido por jornada y equipo, así que la jornada identifica el partido.
 * Conserva también el `id` y `createdAt` del anterior.
 */
export function mergeImportedFixtures(existing: readonly Fixture[], incoming: readonly Fixture[]): Fixture[] {
  const byMatchday = new Map(existing.map((f) => [f.matchday, f]));
  return incoming.map((fresh) => {
    const old = byMatchday.get(fresh.matchday);
    if (!old || old.matchId === null) return fresh;
    return { ...fresh, id: old.id, createdAt: old.createdAt, matchId: old.matchId };
  });
}

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/**
 * Los próximos partidos: sin jugar y de hoy en adelante (el de hoy sigue
 * saliendo aunque ya haya pasado su hora), por fecha y jornada.
 */
export function upcomingFixtures(fixtures: readonly Fixture[], now: number, limit = 5): Fixture[] {
  const today = startOfLocalDay(now);
  return fixtures
    .filter((f) => f.matchId === null && f.scheduledAt >= today)
    .sort((a, b) => a.scheduledAt - b.scheduledAt || a.matchday - b.matchday)
    .slice(0, limit);
}
