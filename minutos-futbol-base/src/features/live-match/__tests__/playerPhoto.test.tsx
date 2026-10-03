import { render } from '@testing-library/react-native';
import { PlayerToken, type PlayerTokenProps } from '../PlayerToken';

const base: PlayerTokenProps = {
  player: { id: 'ana', name: 'Ana', number: 1, photoUri: 'data:image/jpeg;base64,AAAA' },
  location: 'FIELD',
  isGoalkeeper: true,
  unavailable: false,
  playedMs: 125_000,
  tone: 'even',
  selected: false,
  highlighted: false,
  dimmed: false,
  dragging: false,
  onPress: () => undefined,
};

describe('PlayerToken con foto', () => {
  it('muestra la foto, el dorsal en una chapa y el tiempo sobre la banda inferior', async () => {
    const screen = await render(<PlayerToken {...base} />);
    expect(screen.getByTestId('token-photo-ana').props.source).toEqual({ uri: 'data:image/jpeg;base64,AAAA' });
    expect(screen.getByTestId('token-time-ana')).toHaveTextContent('02:05');
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByTestId('token-name-ana')).toHaveTextContent('Ana');
  });

  it('sin foto conserva el dorsal grande dentro del círculo', async () => {
    const screen = await render(<PlayerToken {...base} player={{ id: 'bea', name: 'Bea', number: 2 }} />);
    expect(screen.queryByTestId('token-photo-bea')).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTestId('token-time-bea')).toHaveTextContent('02:05');
  });
});
