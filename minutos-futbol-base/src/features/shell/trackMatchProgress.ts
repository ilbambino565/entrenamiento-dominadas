import type { MatchEngine } from '../../app-services/matchEngine';
import type { MatchProgress } from '../../core/match';
import type { MatchState } from '../../core/state';
import type { MatchRepository } from '../../db/matchRepository';

/**
 * Mantiene la fila `match` al día con el motor: cada vez que cambia el estado
 * o la parte, guarda `status`, `currentPeriod` y las marcas de inicio y fin.
 * La timeline es la verdad y esto solo es la proyección para listar partidos y
 * detectar uno sin terminar (P0), así que un fallo al guardar se registra y no
 * interrumpe el partido; el siguiente cambio vuelve a intentarlo con el estado
 * completo. Las escrituras van en cola, de una en una y en orden.
 */
export interface MatchProgressTracker {
  /** Deja de escuchar y espera a que termine lo que quedaba por guardar. */
  stop(): Promise<void>;
}

export function progressOf(state: MatchState, now: number, previous: MatchProgress): MatchProgress {
  const first = state.clockSegments[0];
  const last = state.clockSegments[state.clockSegments.length - 1];
  const finished = state.status === 'FINISHED';
  return {
    status: state.status,
    currentPeriod: state.currentPeriod,
    startedAt: first ? first.startedAt : null,
    // Al terminar: cuando se cerró el último tramo de reloj; si ya estaba guardado no se mueve.
    finishedAt: finished ? (previous.finishedAt ?? last?.endedAt ?? now) : null,
    updatedAt: now,
  };
}

const sameProgress = (a: MatchProgress, b: MatchProgress): boolean =>
  a.status === b.status && a.currentPeriod === b.currentPeriod && a.startedAt === b.startedAt && a.finishedAt === b.finishedAt;

export function trackMatchProgress(
  engine: MatchEngine,
  repo: MatchRepository,
  matchId: string,
  initial: MatchProgress,
  now: () => number = Date.now,
): MatchProgressTracker {
  let saved = initial;
  let queue: Promise<void> = Promise.resolve();

  const unsubscribe = engine.subscribe((state) => {
    const next = progressOf(state, now(), saved);
    if (sameProgress(next, saved)) return;
    queue = queue.then(async () => {
      try {
        await repo.saveProgress(matchId, next);
        saved = next;
      } catch (error) {
        console.warn('[match] no se pudo guardar el progreso del partido', error);
      }
    });
  });

  return {
    async stop() {
      unsubscribe();
      await queue;
    },
  };
}
