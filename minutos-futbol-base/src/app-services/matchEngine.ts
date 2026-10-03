import type { EventStore } from '../db/eventStore';
import type { EventBus } from '../events/bus';
import type { AppEventMap } from '../events/topics';
import {
  MatchRuleError,
  affectsMatchState,
  applyEvent,
  changedDerivedFields,
  checkInvariants,
  createInitialState,
  deriveEventFields,
  matchClockMs,
  playerPlayedMs,
  reduceMatch,
  summarizeMatch,
  toMatchTimeMs,
  type AnyMatchEvent,
  type AnyNewMatchEvent,
  type EventSource,
  type FieldPosition,
  type LineupEntry,
  type MatchConfig,
  type MatchEndReason,
  type MatchEvent,
  type MatchState,
  type MatchSummary,
  type UnavailableReason,
} from '../core';
import { uuidv7 } from '../lib/uuid';

/**
 * MatchEngine: fachada del partido con persistencia y bus.
 *
 * Une el dominio puro (`reduceMatch`/`applyEvent`), el `EventStore` y el
 * `EventBus`. Regla de oro (docs/03 §3.7): ESCRIBIR ANTES DE MOSTRAR. El estado
 * en memoria solo cambia cuando el evento ya está en el almacén; si el disco
 * falla, la pantalla no miente.
 *
 * Los comandos pasan por una COLA SERIE: dos gestos casi simultáneos se aplican
 * uno detrás de otro, cada uno sobre el estado que dejó el anterior, y `seq`
 * los desempata aunque compartan milisegundo. El instante (`at`) se captura
 * al recibir el comando, no al escribirlo, para que la cola no retrase el reloj.
 *
 * El motor no sabe que existe la cámara: publica `match.*` y acepta eventos
 * externos (`recordExternalEvent`) que entran en la timeline sin tocar el
 * estado. Nada de `src/camera` se importa aquí.
 */

/** El bus de la app: temas del partido y de la cámara. Un mismo bus sirve para los dos lados. */
export type AppBus = EventBus<AppEventMap>;

export interface MatchEngineDeps {
  config: MatchConfig;
  store: EventStore;
  bus: AppBus;
  /** Reloj inyectable (epoch ms). Por defecto `Date.now`. */
  now?: () => number;
  /** Generador de ids de evento. Por defecto UUIDv7 con `now`. */
  newId?: () => string;
}

export type MatchStateListener = (state: MatchState) => void;

export interface MatchEngine {
  /**
   * Carga la timeline del almacén, regenera el estado y comprueba invariantes.
   * Si el log es incoherente lanza (gana el log; en este hito no se corrige).
   * Hay que llamarla antes de cualquier comando.
   */
  load(): Promise<MatchState>;
  getState(): MatchState;
  /** Todos los eventos, anulados incluidos, en orden de `seq`. */
  getEvents(): readonly MatchEvent[];
  /** Solo los no anulados, en orden de `seq`. */
  getTimeline(): readonly MatchEvent[];
  subscribe(listener: MatchStateListener): () => void;

  // Comandos. Lanzan MatchRuleError si no son válidos (y entonces nada se persiste).
  // `at` = instante real del gesto (epoch ms); por defecto `now()`.
  setLineup(field: LineupEntry[], bench: string[], at?: number): Promise<MatchEvent>;
  start(at?: number): Promise<MatchEvent>;
  pause(at?: number): Promise<MatchEvent>;
  resume(at?: number): Promise<MatchEvent>;
  startHalftime(at?: number): Promise<MatchEvent>;
  startNextPeriod(at?: number): Promise<MatchEvent>;
  end(reason?: MatchEndReason, at?: number): Promise<MatchEvent>;
  enterPlayer(playerId: string, position: FieldPosition, at?: number): Promise<MatchEvent>;
  leavePlayer(playerId: string, at?: number): Promise<MatchEvent>;
  /** Sin `position`, el que entra ocupa el sitio del que sale. */
  substitute(inPlayerId: string, outPlayerId: string, position?: FieldPosition, at?: number): Promise<MatchEvent>;
  movePlayer(playerId: string, position: FieldPosition, at?: number): Promise<MatchEvent>;
  swapPlayers(playerId: string, otherPlayerId: string, at?: number): Promise<MatchEvent>;
  setGoalkeeper(playerId: string, at?: number): Promise<MatchEvent>;
  addPlayer(playerId: string, at?: number): Promise<MatchEvent>;
  setUnavailable(
    playerId: string,
    unavailable: boolean,
    reason: UnavailableReason | null,
    at?: number,
  ): Promise<MatchEvent>;

  /**
   * Evento que NO afecta al estado (goles, tarjetas, cámara): entra en la
   * timeline con `matchTimeMs`/`period` del reloj actual. Rechaza con
   * MatchRuleError('INVALID_EVENT') los tipos de reloj/jugadores y EVENT_UNDONE.
   */
  recordExternalEvent(input: AnyNewMatchEvent): Promise<MatchEvent>;

  /**
   * Anula el último evento de usuario no anulado y devuelve su copia anulada
   * (null si no hay nada que deshacer). Con `expectedTargetId` (el evento que
   * la UI mostraba en el botón), rechaza con MatchRuleError('INVALID_EVENT') si
   * entre tanto entró otro gesto: nunca se deshace algo distinto de lo que se ve.
   */
  undo(at?: number, expectedTargetId?: string): Promise<MatchEvent | null>;
  /** Lo que desharía `undo()` ahora mismo (para el rótulo del botón). */
  peekUndo(): MatchEvent | null;

  /**
   * Consultas. `now` se acota a la última marca guardada: si el reloj del
   * sistema ha retrocedido, los tramos abiertos se cierran en un instante
   * coherente con los ya cerrados y reloj y jugadores siguen cuadrando.
   */
  playedMs(playerId: string, now?: number): number;
  clockMs(now?: number): number;
  summary(now?: number): MatchSummary;
}

export function createMatchEngine(deps: MatchEngineDeps): MatchEngine {
  const { config, store, bus } = deps;
  const { matchId } = config;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => uuidv7(now()));

  let state: MatchState = createInitialState(config);
  let events: readonly MatchEvent[] = [];
  let loaded = false;
  const listeners = new Set<MatchStateListener>();

  // ───────────── Cola serie ─────────────

  // La cadena nunca queda rechazada: un comando inválido no bloquea al siguiente.
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function requireLoaded(): void {
    if (!loaded) throw new Error(`El partido ${matchId} no está cargado: llama a load() antes de enviar comandos`);
  }

  // ───────────── Construcción y commit ─────────────

  function requireInstant(value: number, what: string): number {
    if (!Number.isFinite(value)) throw new MatchRuleError('INVALID_EVENT', `${what} no es un instante válido: ${value}`);
    return value;
  }

  /** Evento completo a partir de la intención. `matchTimeMs`/`period` se rellenan en `derive`. */
  function materialize(base: MatchState, input: AnyNewMatchEvent, source: EventSource): MatchEvent {
    requireInstant(input.timestamp, `timestamp de ${input.type}`);
    return {
      id: newId(),
      matchId,
      seq: base.lastSeq + 1,
      type: input.type,
      timestamp: input.timestamp,
      matchTimeMs: 0,
      period: 0,
      playerId: input.playerId ?? null,
      secondaryPlayerId: input.secondaryPlayerId ?? null,
      metadata: input.metadata,
      source,
      voidedAt: null,
    };
  }

  /**
   * Campos derivados medidos sobre el estado YA con el evento aplicado: así
   * MATCH_STARTED queda en 0 / periodo 1 y PERIOD_STARTED en el periodo nuevo,
   * la misma regla que usa `deriveEventFields` al regenerar.
   */
  function derive(event: MatchEvent, next: MatchState): MatchEvent {
    return { ...event, matchTimeMs: toMatchTimeMs(next.clockSegments, event.timestamp), period: next.currentPeriod };
  }

  function notify(): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch (error) {
        // Un suscriptor roto no puede impedir que el resto vea el estado persistido.
        console.error('[MatchEngine] error en un suscriptor', error);
      }
    }
  }

  /** Escribir antes de mostrar: el estado en memoria solo cambia tras `append`. */
  async function commit(event: MatchEvent, next: MatchState): Promise<void> {
    await store.append(event);
    state = next;
    events = [...events, event];
    notify();
  }

  /** Tema específico del evento (si lo tiene) y, siempre, `match.event.recorded`. */
  function publish(event: MatchEvent, next: MatchState): void {
    const { timestamp, matchTimeMs } = event;
    const period = next.currentPeriod;
    const e = event as AnyMatchEvent;
    switch (e.type) {
      case 'MATCH_STARTED':
        bus.emit('match.started', { matchId, timestamp, period });
        break;
      case 'MATCH_PAUSED':
        bus.emit('match.paused', { matchId, timestamp, period });
        break;
      case 'MATCH_RESUMED':
        bus.emit('match.resumed', { matchId, timestamp, period });
        break;
      case 'HALFTIME_STARTED':
        bus.emit('match.halftime', { matchId, timestamp, period });
        break;
      case 'PERIOD_STARTED':
        bus.emit('match.period.started', { matchId, timestamp, period });
        break;
      case 'MATCH_ENDED':
        bus.emit('match.finished', { matchId, timestamp, reason: e.metadata.reason });
        break;
      // Tras `applyEvent` los jugadores existen; la guarda solo estrecha el tipo.
      case 'PLAYER_ENTERED':
        if (e.playerId) bus.emit('player.entered', { matchId, playerId: e.playerId, timestamp, matchTimeMs });
        break;
      case 'PLAYER_LEFT':
        if (e.playerId) bus.emit('player.left', { matchId, playerId: e.playerId, timestamp, matchTimeMs });
        break;
      case 'SUBSTITUTION':
        if (e.playerId && e.secondaryPlayerId) {
          bus.emit('player.substituted', {
            matchId,
            inPlayerId: e.playerId,
            outPlayerId: e.secondaryPlayerId,
            timestamp,
            matchTimeMs,
          });
        }
        break;
      default:
        break;
    }
    bus.emit('match.event.recorded', { event });
  }

  /**
   * Pipeline de un comando de usuario: construir → aplicar (valida: si lanza,
   * nada se persiste) → derivar → persistir → commit → notificar → publicar.
   */
  function command(
    at: number | undefined,
    build: (timestamp: number, current: MatchState) => AnyNewMatchEvent,
  ): Promise<MatchEvent> {
    // Capturado en el gesto, no al escribir: la cola no introduce retrasos.
    const timestamp = at ?? now();
    return serialize(async () => {
      requireLoaded();
      const event = materialize(state, build(timestamp, state), 'user');
      const next = applyEvent(state, event);
      const persisted = derive(event, next);
      await commit(persisted, next);
      publish(persisted, next);
      return persisted;
    });
  }

  // ───────────── Deshacer ─────────────

  /** Último evento de usuario no anulado. Los de cámara y sistema no se deshacen desde aquí. */
  function undoTarget(): MatchEvent | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event && event.source === 'user' && event.voidedAt == null) return event;
    }
    return null;
  }

  /**
   * Recalcula `matchTimeMs`/`period` de toda la timeline y persiste solo los
   * que cambian (p. ej. deshacer una pausa mueve el minuto de los eventos
   * posteriores). Si el disco falla, la memoria se queda con los derivados
   * antiguos, iguales a los del disco: nunca memoria ≠ disco. El siguiente
   * `load()` o deshacer los volverá a intentar.
   */
  async function refreshDerived(current: readonly MatchEvent[]): Promise<readonly MatchEvent[]> {
    const derived = deriveEventFields(current);
    const changes = changedDerivedFields(current, derived);
    if (changes.length === 0) return derived;
    try {
      await store.updateDerived(matchId, changes);
      return derived;
    } catch (error) {
      console.warn('[MatchEngine] no se pudieron actualizar los campos derivados; se reintentará al abrir', error);
      return current;
    }
  }

  function undo(at?: number, expectedTargetId?: string): Promise<MatchEvent | null> {
    // Capturado en el gesto, igual que en los comandos.
    const voidedAt = at ?? now();
    return serialize(async () => {
      requireLoaded();
      requireInstant(voidedAt, 'instante del deshacer');
      const target = undoTarget();
      if (!target) return null;
      if (expectedTargetId !== undefined && target.id !== expectedTargetId) {
        throw new MatchRuleError(
          'INVALID_EVENT',
          `Lo último ya no es ${expectedTargetId} sino ${target.type}: vuelve a mirar qué vas a deshacer`,
        );
      }

      // 1. Anular en disco y, acto seguido, en memoria. Desde aquí el deshacer
      //    es un hecho: la pantalla lo refleja aunque falle lo que sigue. El
      //    anulado solo avanza `lastSeq` y los posteriores no son de usuario
      //    (el objetivo era el último), así que la regeneración no puede fallar.
      await store.markVoided(matchId, target.id, voidedAt);
      const withVoided = events.map((e) => (e.id === target.id ? { ...e, voidedAt } : e));
      state = reduceMatch(config, withVoided);
      events = withVoided;
      notify();

      // 2. Campos derivados (best-effort, ver refreshDerived).
      events = await refreshDerived(withVoided);

      // Se devuelve la copia regenerada (sus propios campos derivados pueden
      // haber cambiado, p. ej. al anular MATCH_STARTED), no la original.
      const voided = events.find((e) => e.id === target.id) ?? { ...target, voidedAt };
      bus.emit('match.event.undone', { event: voided });

      // 3. Rastro informativo: se ignora al regenerar. Si no se puede escribir
      //    no invalida un deshacer ya consumado (memoria y disco coinciden).
      try {
        const undone = materialize(
          state,
          { type: 'EVENT_UNDONE', timestamp: voidedAt, metadata: { targetEventId: target.id } },
          'system',
        );
        const next = applyEvent(state, undone);
        const persisted = derive(undone, next);
        await commit(persisted, next);
        bus.emit('match.event.recorded', { event: persisted });
      } catch (error) {
        console.warn('[MatchEngine] no se pudo registrar el rastro EVENT_UNDONE', error);
      }
      return voided;
    });
  }

  /**
   * Instante de consulta acotado a la última marca guardada: con el reloj del
   * sistema hacia atrás, un intervalo abierto se cerraría "antes" que el
   * segmento ya cerrado y el jugador sumaría menos que el reloj.
   */
  function queryInstant(at: number): number {
    let instant = at;
    for (const e of events) if (e.timestamp > instant) instant = e.timestamp;
    return instant;
  }

  // ───────────── API ─────────────

  return {
    load: () =>
      serialize(async () => {
        const stored = await store.loadEvents(matchId);
        const regenerated = reduceMatch(config, stored);
        const problems = checkInvariants(regenerated);
        if (problems.length > 0) {
          throw new Error(`La timeline del partido ${matchId} viola invariantes: ${problems.join('; ')}`);
        }
        // Comprobación de integridad al abrir (docs/03 §3.7.6): si los derivados
        // guardados no coinciden con los recalculados (p. ej. cierre a mitad de
        // un deshacer), gana el log y se reescriben.
        state = regenerated;
        events = await refreshDerived(stored);
        loaded = true;
        notify();
        return state;
      }),

    getState: () => state,
    getEvents: () => events,
    getTimeline: () => events.filter((e) => e.voidedAt == null),

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setLineup: (field, bench, at) =>
      command(at, (timestamp) => ({ type: 'LINEUP_SET', timestamp, metadata: { field, bench } })),
    start: (at) => command(at, (timestamp) => ({ type: 'MATCH_STARTED', timestamp, metadata: {} })),
    pause: (at) => command(at, (timestamp) => ({ type: 'MATCH_PAUSED', timestamp, metadata: {} })),
    resume: (at) => command(at, (timestamp) => ({ type: 'MATCH_RESUMED', timestamp, metadata: {} })),
    startHalftime: (at) => command(at, (timestamp) => ({ type: 'HALFTIME_STARTED', timestamp, metadata: {} })),
    startNextPeriod: (at) => command(at, (timestamp) => ({ type: 'PERIOD_STARTED', timestamp, metadata: {} })),
    end: (reason = 'NORMAL', at) =>
      command(at, (timestamp) => ({ type: 'MATCH_ENDED', timestamp, metadata: { reason } })),

    enterPlayer: (playerId, position, at) =>
      command(at, (timestamp) => ({ type: 'PLAYER_ENTERED', timestamp, playerId, metadata: { position } })),
    leavePlayer: (playerId, at) =>
      command(at, (timestamp) => ({ type: 'PLAYER_LEFT', timestamp, playerId, metadata: {} })),
    substitute: (inPlayerId, outPlayerId, position, at) =>
      command(at, (timestamp, current) => {
        // Sin posición explícita el que entra hereda el sitio del que sale; si
        // este no está en el campo no hay sitio que heredar (y el cambio es inválido).
        const resolved = position ?? current.players[outPlayerId]?.position;
        if (!resolved) {
          throw new MatchRuleError('PLAYER_NOT_ON_FIELD', `${outPlayerId} no está en el campo: no hay posición que heredar`);
        }
        return {
          type: 'SUBSTITUTION',
          timestamp,
          playerId: inPlayerId,
          secondaryPlayerId: outPlayerId,
          metadata: { position: resolved },
        };
      }),
    movePlayer: (playerId, position, at) =>
      command(at, (timestamp) => ({ type: 'PLAYER_MOVED', timestamp, playerId, metadata: { position } })),
    swapPlayers: (playerId, otherPlayerId, at) =>
      command(at, (timestamp) => ({
        type: 'PLAYERS_SWAPPED',
        timestamp,
        playerId,
        secondaryPlayerId: otherPlayerId,
        metadata: {},
      })),
    setGoalkeeper: (playerId, at) =>
      command(at, (timestamp) => ({ type: 'GOALKEEPER_SET', timestamp, playerId, metadata: {} })),
    addPlayer: (playerId, at) =>
      command(at, (timestamp) => ({ type: 'PLAYER_ADDED', timestamp, playerId, metadata: {} })),
    setUnavailable: (playerId, unavailable, reason, at) =>
      command(at, (timestamp) => ({
        type: 'PLAYER_UNAVAILABLE',
        timestamp,
        playerId,
        metadata: { unavailable, reason },
      })),

    recordExternalEvent: (input) =>
      serialize(async () => {
        if (affectsMatchState(input.type) || input.type === 'EVENT_UNDONE') {
          throw new MatchRuleError('INVALID_EVENT', `${input.type} no es un evento externo: usa el comando correspondiente`);
        }
        requireLoaded();
        const event = materialize(state, input, input.source ?? 'user');
        // Para estos tipos `applyEvent` solo comprueba el partido y avanza `lastSeq`:
        // el reloj y los jugadores quedan intactos.
        const next = applyEvent(state, event);
        const persisted = derive(event, next);
        await commit(persisted, next);
        bus.emit('match.event.recorded', { event: persisted });
        return persisted;
      }),

    undo,
    peekUndo: undoTarget,

    playedMs: (playerId, at = now()) => playerPlayedMs(state, playerId, queryInstant(at)),
    clockMs: (at = now()) => matchClockMs(state.clockSegments, queryInstant(at)),
    summary: (at = now()) => summarizeMatch(state, queryInstant(at)),
  };
}
