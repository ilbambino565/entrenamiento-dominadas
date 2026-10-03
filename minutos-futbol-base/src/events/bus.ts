/**
 * EventBus interno, síncrono y tipado.
 *
 * - `emit` entrega a los suscriptores en el mismo tick: quien publica no espera
 *   a nadie y un suscriptor que falle no afecta a los demás ni al publicador.
 * - Es genérico sobre el mapa de temas para que un módulo pueda declarar solo
 *   los temas que le incumben (p. ej. `EventBus<CameraEventMap>`).
 */

export type Unsubscribe = () => void;

export type Handler<P> = (payload: P) => void;

/**
 * `TMap extends object` (y no `Record<string, unknown>`) a propósito: los mapas
 * de temas se declaran como `interface` y una interfaz no tiene firma de índice
 * implícita, así que `Record` los rechazaría. `keyof TMap & string` basta.
 */
export interface EventBus<TMap extends object> {
  emit<K extends keyof TMap & string>(topic: K, payload: TMap[K]): void;
  on<K extends keyof TMap & string>(topic: K, handler: Handler<TMap[K]>): Unsubscribe;
  once<K extends keyof TMap & string>(topic: K, handler: Handler<TMap[K]>): Unsubscribe;
  off<K extends keyof TMap & string>(topic: K, handler: Handler<TMap[K]>): void;
  listenerCount(topic: keyof TMap & string): number;
  clear(): void;
}

export interface EventBusOptions {
  /** Se invoca si un suscriptor lanza. Por defecto: console.error. */
  onError?: (error: unknown, topic: string) => void;
}

export function createEventBus<TMap extends object>(options: EventBusOptions = {}): EventBus<TMap> {
  const handlers = new Map<string, Set<Handler<unknown>>>();
  const onError =
    options.onError ??
    ((error: unknown, topic: string) => {
      console.error(`[EventBus] error en suscriptor de "${topic}"`, error);
    });

  const bus: EventBus<TMap> = {
    emit(topic, payload) {
      const set = handlers.get(topic);
      if (!set || set.size === 0) return;
      // Copia: un handler puede desuscribirse (o suscribir otros) durante la entrega.
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (error) {
          onError(error, topic);
        }
      }
    },

    on(topic, handler) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(handler as Handler<unknown>);
      return () => bus.off(topic, handler);
    },

    once(topic, handler) {
      const wrapped: Handler<TMap[typeof topic]> = (payload) => {
        bus.off(topic, wrapped);
        handler(payload);
      };
      return bus.on(topic, wrapped);
    },

    off(topic, handler) {
      const set = handlers.get(topic);
      if (!set) return;
      set.delete(handler as Handler<unknown>);
      if (set.size === 0) handlers.delete(topic);
    },

    listenerCount(topic) {
      return handlers.get(topic)?.size ?? 0;
    },

    clear() {
      handlers.clear();
    },
  };

  return bus;
}
