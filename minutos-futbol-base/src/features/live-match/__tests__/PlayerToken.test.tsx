import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LIGHT } from '../../../ui/theme';
import { TOKEN_COLUMN_HEIGHT, TOKEN_NAME_HEIGHT, TOKEN_SIZE } from '../geometry';
import { PlayerToken, type PlayerTokenProps } from '../PlayerToken';

/**
 * La ficha sola (sin gesto): lo que garantiza la legibilidad al sol y la
 * altura de 84 dp. En Jest `useColorScheme()` devuelve el tema claro.
 */
const base: PlayerTokenProps = {
  player: { id: 'lucas', name: 'Lucas', number: 7 },
  location: 'FIELD',
  isGoalkeeper: false,
  unavailable: false,
  playedMs: 65_000,
  tone: 'even',
  selected: false,
  highlighted: false,
  dimmed: false,
  dragging: false,
  onPress: () => undefined,
};

const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);

describe('PlayerToken', () => {
  it('en el campo: tiempo dentro del círculo, nombre sobre una pastilla surface y halo claro alrededor', async () => {
    const screen = await render(<PlayerToken {...base} />);
    expect(screen.getByTestId('token-time-lucas')).toHaveTextContent('01:05');
    expect(screen.getByTestId('token-time-lucas').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: LIGHT.colors.onAccent })]));
    expect(flat(screen.getByTestId('token-name-lucas').props.style)).toMatchObject({ backgroundColor: LIGHT.colors.surface, height: TOKEN_NAME_HEIGHT });
    expect(flat(screen.getByTestId('token-halo-lucas').props.style)).toMatchObject({ backgroundColor: LIGHT.colors.grassLine, width: TOKEN_SIZE + 4 });
    // La columna es círculo + 2 + pastilla: lo que `fieldTokenCenter` reserva.
    expect(TOKEN_SIZE + 2 + TOKEN_NAME_HEIGHT).toBe(TOKEN_COLUMN_HEIGHT);
    // Sin % en el campo: el anillo ya codifica el reparto.
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('en el banquillo no hay halo (el fondo ya es claro) y la línea ⏱ aparece debajo', async () => {
    const screen = await render(<PlayerToken {...base} location="BENCH" footnote="⏱ 3'" />);
    expect(screen.queryByTestId('token-halo-lucas')).toBeNull();
    expect(screen.getByTestId('token-lucas')).toHaveTextContent(/⏱ 3'/);
  });

  it('el portero usa el texto para ámbar (el blanco no llega a AA en claro)', async () => {
    const screen = await render(<PlayerToken {...base} isGoalkeeper />);
    expect(screen.getByTestId('token-time-lucas').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: LIGHT.colors.onAmber })]));
  });

  it('la etiqueta accesible dice dónde está y si está lesionado', async () => {
    const screen = await render(<PlayerToken {...base} location="BENCH" unavailable />);
    expect(screen.getByTestId('token-lucas').props.accessibilityLabel).toBe('Lucas, dorsal 7, en el banquillo, 01:05 jugados, lesionado');
    expect(screen.getByTestId('token-lucas').props.accessibilityHint).toMatch(/seleccionar/);
  });
});
