import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { useNow } from '../useNow';

jest.useFakeTimers();

function Probe({ interval }: { interval?: number }) {
  const now = useNow(interval);
  return <Text testID="now">{String(now)}</Text>;
}

describe('useNow', () => {
  // jest-expo deja AppState.addEventListener como jest.fn() sin suscripción: se simula la real.
  let listeners: Array<(s: string) => void> = [];
  const remove = jest.fn();
  let spy: jest.SpyInstance;
  beforeEach(() => {
    listeners = [];
    remove.mockClear();
    spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listeners.push(handler as (s: string) => void);
      return { remove } as never;
    });
  });
  afterEach(() => spy.mockRestore());

  it('avanza con el intervalo y se actualiza al volver a primer plano', async () => {

    jest.setSystemTime(1_000_000);
    const screen = await render(<Probe />);
    expect(screen.getByTestId('now')).toHaveTextContent('1000000');

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('1001000');

    // Entre ticks, el reloj del sistema salta (móvil bloqueado): 'active' refresca ya.
    await act(async () => {
      jest.setSystemTime(2_000_000);
      for (const l of listeners) l('active');
    });
    expect(screen.getByTestId('now')).toHaveTextContent('2000000');

    await act(async () => {
      for (const l of listeners) l('background');
      jest.setSystemTime(3_000_000);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('2000000');

    await screen.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('respeta el intervalo indicado y limpia el temporizador al desmontar', async () => {
    jest.setSystemTime(0);
    const clear = jest.spyOn(globalThis, 'clearInterval');
    const screen = await render(<Probe interval={250} />);
    await act(async () => {
      jest.advanceTimersByTime(260);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('250');
    await screen.unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
