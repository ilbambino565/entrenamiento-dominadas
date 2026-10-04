import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { Player } from '../../../core/team';
import { ConvocationScreen } from '../ConvocationScreen';

/** P6 con una plantilla inventada: todos marcados por defecto y toda la fila tocable. */
const player = (n: number, overrides: Partial<Player> = {}): Player => ({
  id: `p${n}`,
  teamId: 't',
  firstName: ['Ana', 'Bea', 'Cris', 'Dani', 'Eli', 'Fran', 'Gema', 'Hana'][n - 1] ?? `J${n}`,
  lastName: 'Prueba',
  shirtNumber: n,
  isGoalkeeper: n === 1,
  isActive: true,
  photoUri: null,
  photoConsent: false,
  sortOrder: n,
  createdAt: n,
  updatedAt: n,
  deletedAt: null,
  ...overrides,
});
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const isChecked = (el: { props: { accessibilityState?: { checked?: boolean } } }) => el.props.accessibilityState?.checked === true;

const squad = [player(1), player(2), player(3, { isActive: false }), player(4), player(5, { deletedAt: 9 }), player(6)];

async function setup(overrides: Partial<React.ComponentProps<typeof ConvocationScreen>> = {}) {
  const onContinue = jest.fn();
  const onBack = jest.fn();
  const screen = await render(
    <ConvocationScreen players={squad} displayNameMode="first_initial" playersOnField={3} onContinue={onContinue} onBack={onBack} {...overrides} />,
  );
  return { screen, onContinue, onBack };
}

describe('ConvocationScreen (P6)', () => {
  it('lista solo activos no eliminados, todos marcados, con contador y paso 2 / 3', async () => {
    const { screen } = await setup();
    for (const id of ['p1', 'p2', 'p4', 'p6']) expect(isChecked(screen.getByTestId(`convocation-row-${id}`))).toBe(true);
    expect(screen.queryByTestId('convocation-row-p3')).toBeNull();
    expect(screen.queryByTestId('convocation-row-p5')).toBeNull();
    expect(screen.getByTestId('convocation-count')).toHaveTextContent('4 / 4');
    expect(screen.getByTestId('convocation-step')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId('convocation-name-p2')).toHaveTextContent('Bea P.');
  });

  it('tocar la fila marca y desmarca; Ninguno y Todos cambian a la vez', async () => {
    const { screen } = await setup();
    await fireEvent.press(screen.getByTestId('convocation-row-p2'));
    expect(isChecked(screen.getByTestId('convocation-row-p2'))).toBe(false);
    expect(screen.getByTestId('convocation-box-p2')).toHaveTextContent('☐');
    expect(screen.getByTestId('convocation-count')).toHaveTextContent('3 / 4');

    await fireEvent.press(screen.getByTestId('convocation-none'));
    expect(screen.getByTestId('convocation-count')).toHaveTextContent('0 / 4');
    await fireEvent.press(screen.getByTestId('convocation-all'));
    expect(screen.getByTestId('convocation-count')).toHaveTextContent('4 / 4');
  });

  it('entrega los convocados en orden de plantilla', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.press(screen.getByTestId('convocation-row-p2'));
    await fireEvent.press(screen.getByTestId('convocation-row-p2'));
    await fireEvent.press(screen.getByTestId('convocation-row-p4'));
    await fireEvent.press(screen.getByTestId('convocation-continue'));
    expect(onContinue).toHaveBeenCalledWith(['p1', 'p2', 'p6']);
  });

  it('sin nadie marcado bloquea y avisa; con menos que en campo avisa pero deja seguir', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.press(screen.getByTestId('convocation-none'));
    expect(screen.queryByTestId('convocation-issue')).toBeNull();
    await fireEvent.press(screen.getByTestId('convocation-continue'));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId('convocation-issue')).toHaveTextContent('Convoca al menos a un jugador');

    await fireEvent.press(screen.getByTestId('convocation-row-p1'));
    await fireEvent.press(screen.getByTestId('convocation-row-p2'));
    expect(screen.getByTestId('convocation-issue')).toHaveTextContent('Con 2 jugadores faltan 1 para completar el campo de 3');
    await fireEvent.press(screen.getByTestId('convocation-continue'));
    expect(onContinue).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('respeta la selección inicial al volver, ignorando ids que ya no se pueden convocar', async () => {
    const { screen } = await setup({ initialSelected: ['p4', 'p3', 'zz'] });
    expect(screen.getByTestId('convocation-count')).toHaveTextContent('1 / 4');
    expect(isChecked(screen.getByTestId('convocation-row-p4'))).toBe(true);
    expect(isChecked(screen.getByTestId('convocation-row-p1'))).toBe(false);
  });

  it('sin jugadores activos lo dice y no deja continuar', async () => {
    const { screen, onContinue } = await setup({ players: [player(1, { isActive: false })] });
    expect(screen.getByTestId('convocation-empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('convocation-continue'));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('medidas de docs/05 y ← llama a onBack', async () => {
    const { screen, onBack } = await setup();
    expect(flat(screen.getByTestId('convocation-row-p1').props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(screen.getByTestId('convocation-continue').props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(screen.getByTestId('convocation-all').props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(screen.getByTestId('convocation-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
