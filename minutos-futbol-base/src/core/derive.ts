import type { MatchEvent } from './events';
import { isClockEvent } from './events';
import type { ClockSegment } from './state';
import { applyClockEvent } from './reducer';
import { toMatchTimeMs } from './time';

/**
 * Recalcula los campos DERIVADOS de la timeline: `matchTimeMs` y `period`.
 *
 * ¿Por qué son derivados y no se escriben una vez y ya? Porque dependen de los
 * eventos de reloj que haya en vigor, y esos cambian: al DESHACER una pausa o
 * un descanso, o al corregir "el descanso empezó hace 3 minutos", el minuto de
 * partido de todos los eventos posteriores cambia aunque su `timestamp` real
 * (lo único que es un hecho) siga siendo el mismo. Guardarlos solo sirve para
 * listar, exportar y cortar vídeo sin recalcular; la verdad es el `timestamp`.
 */

export interface DerivedFieldsUpdate {
  id: string;
  matchTimeMs: number;
  period: number;
}

/**
 * Devuelve copias de TODOS los eventos (anulados y de cámara incluidos),
 * ordenadas por `seq`, con `matchTimeMs` y `period` recalculados a partir de
 * los eventos de reloj NO anulados. Un evento solo ve los segmentos conocidos
 * hasta su propio `seq`; el de reloj se aplica antes de medirse a sí mismo,
 * así MATCH_STARTED queda en 0 / periodo 1 y PERIOD_STARTED en el periodo nuevo.
 */
export function deriveEventFields(events: readonly MatchEvent[]): MatchEvent[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let segments: ClockSegment[] = [];
  let currentPeriod = 0;
  return ordered.map((event) => {
    if (event.voidedAt == null && isClockEvent(event.type)) {
      ({ segments, currentPeriod } = applyClockEvent(segments, currentPeriod, event.type, event.timestamp));
    }
    return { ...event, matchTimeMs: toMatchTimeMs(segments, event.timestamp), period: currentPeriod };
  });
}

/** Solo los eventos cuyos campos derivados cambian: lo mínimo que hay que persistir. */
export function changedDerivedFields(
  before: readonly MatchEvent[],
  after: readonly MatchEvent[],
): DerivedFieldsUpdate[] {
  const previous = new Map(before.map((e) => [e.id, e]));
  const changes: DerivedFieldsUpdate[] = [];
  for (const e of after) {
    const old = previous.get(e.id);
    if (old && old.matchTimeMs === e.matchTimeMs && old.period === e.period) continue;
    changes.push({ id: e.id, matchTimeMs: e.matchTimeMs, period: e.period });
  }
  return changes;
}
