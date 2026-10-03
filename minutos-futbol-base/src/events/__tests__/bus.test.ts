import { createEventBus } from '../bus';

type SmallMap = { ping: { n: number }; pong: undefined };

describe('createEventBus', () => {
  it('on/emit entrega el payload a todos los suscriptores en orden de suscripción', () => {
    const bus = createEventBus<SmallMap>();
    const order: string[] = [];
    bus.on('ping', (p) => order.push(`a${p.n}`));
    bus.on('ping', (p) => order.push(`b${p.n}`));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('emit sin suscriptores y off de un handler desconocido no fallan', () => {
    const bus = createEventBus<SmallMap>();
    expect(() => bus.emit('pong', undefined)).not.toThrow();
    expect(() => bus.off('ping', () => {})).not.toThrow();
  });

  it('off y la función devuelta por on desuscriben; listenerCount lo refleja', () => {
    const bus = createEventBus<SmallMap>();
    const a = jest.fn();
    const b = jest.fn();
    const offA = bus.on('ping', a);
    bus.on('ping', b);
    expect(bus.listenerCount('ping')).toBe(2);

    offA();
    expect(bus.listenerCount('ping')).toBe(1);
    bus.off('ping', b);
    expect(bus.listenerCount('ping')).toBe(0);

    bus.emit('ping', { n: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('el mismo handler suscrito dos veces cuenta una sola vez', () => {
    const bus = createEventBus<SmallMap>();
    const a = jest.fn();
    bus.on('ping', a);
    bus.on('ping', a);
    bus.emit('ping', { n: 1 });
    expect(bus.listenerCount('ping')).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('once se ejecuta una sola vez y se puede cancelar antes', () => {
    const bus = createEventBus<SmallMap>();
    const a = jest.fn();
    const b = jest.fn();
    bus.once('ping', a);
    const offB = bus.once('ping', b);
    offB();

    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('clear elimina todos los suscriptores de todos los temas', () => {
    const bus = createEventBus<SmallMap>();
    const a = jest.fn();
    bus.on('ping', a);
    bus.on('pong', a);
    bus.clear();
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('pong')).toBe(0);
    bus.emit('ping', { n: 1 });
    bus.emit('pong', undefined);
    expect(a).not.toHaveBeenCalled();
  });

  it('un suscriptor que lanza no impide a los demás y se reporta por onError', () => {
    const onError = jest.fn();
    const bus = createEventBus<SmallMap>({ onError });
    const boom = new Error('boom');
    const after = jest.fn();
    bus.on('ping', () => {
      throw boom;
    });
    bus.on('ping', after);

    expect(() => bus.emit('ping', { n: 7 })).not.toThrow();
    expect(after).toHaveBeenCalledWith({ n: 7 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom, 'ping');
  });

  it('sin onError usa console.error y el publicador no se entera', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bus = createEventBus<SmallMap>();
      bus.on('ping', () => {
        throw new Error('boom');
      });
      expect(() => bus.emit('ping', { n: 1 })).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('desuscribirse durante la entrega es seguro', () => {
    const bus = createEventBus<SmallMap>();
    const calls: string[] = [];
    const offA = bus.on('ping', () => {
      calls.push('a');
      offA();
    });
    bus.on('ping', () => calls.push('b'));

    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    // La primera entrega llega a los dos; en la segunda `a` ya no está.
    expect(calls).toEqual(['a', 'b', 'b']);
    expect(bus.listenerCount('ping')).toBe(1);
  });

  it('suscribir durante la entrega no afecta a la entrega en curso', () => {
    const bus = createEventBus<SmallMap>();
    const late = jest.fn();
    bus.on('ping', () => {
      if (bus.listenerCount('ping') === 1) bus.on('ping', late);
    });

    bus.emit('ping', { n: 1 });
    expect(late).not.toHaveBeenCalled();
    bus.emit('ping', { n: 2 });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('tipado: tema y payload se comprueban en compilación', () => {
    const bus = createEventBus<SmallMap>();
    bus.on('ping', (p) => {
      const n: number = p.n;
      expect(typeof n).toBe('number');
    });
    bus.emit('ping', { n: 1 });
    bus.emit('pong', undefined);

    // Solo compila, nunca se ejecuta: lo que importa es que tsc rechace cada línea.
    const rejectedByCompiler = () => {
      // @ts-expect-error payload incompatible con 'ping'
      bus.emit('ping', { n: 'uno' });
      // @ts-expect-error tema inexistente
      bus.emit('nope', {});
      // @ts-expect-error el handler recibe el payload de 'ping', no una cadena
      bus.on('ping', (p: string) => p);
    };
    expect(typeof rejectedByCompiler).toBe('function');
  });
});
