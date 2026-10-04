import type { EventStore } from '../../db/eventStore';
import type { FixtureRepository } from '../../db/fixtureRepository';
import type { MatchRepository } from '../../db/matchRepository';
import type { SquadRepository } from '../../db/squadRepository';

/**
 * Todo lo que la app persiste, abierto UNA vez por proceso: la plantilla, los
 * partidos (con su convocatoria), el calendario importado y la timeline de eventos. En nativo los tres
 * comparten la misma base SQLite; en web no hay SQLite y partidos y timeline
 * viven en memoria (se pierden al recargar), solo la plantilla se copia a
 * `localStorage`. Las dos variantes están en `openPersistence(.web).ts`.
 */
export interface Persistence {
  squad: SquadRepository;
  matches: MatchRepository;
  /** Calendario importado de la federación (solo los partidos del equipo). */
  fixtures: FixtureRepository;
  /** Una sola timeline para todos los partidos: cada uno se identifica por su `matchId`. */
  events: EventStore;
}
