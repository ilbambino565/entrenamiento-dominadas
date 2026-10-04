import { createMatchSession, type MatchSession } from '../../app-services/createMatchSession';
import type { MatchSetup } from '../../app-services/squadService';
import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { uuidv7 } from '../../lib/uuid';

/**
 * Sesión de partido con la plantilla real. De momento la timeline vive en un
 * EventStore en memoria y se pierde al salir de la pantalla: crear partido,
 * guardarlo y recuperarlo al arrancar (M4, P0) es el siguiente paso y solo
 * cambiará el `store` de aquí. La sesión se crea UNA vez por partido (el
 * shell la guarda en su estado) y se libera con `session.dispose()` al salir.
 */
export interface ActiveMatch {
  session: MatchSession;
  setup: MatchSetup;
}

export function startMatch(setup: MatchSetup, now: () => number = Date.now): ActiveMatch {
  const session = createMatchSession({
    config: { ...setup.config, matchId: uuidv7(now()) },
    store: createInMemoryEventStore(),
    cameraSettings: null,
    now,
  });
  return { session, setup };
}
