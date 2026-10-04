import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MatchSetupScreen } from '../MatchSetupScreen';

/** P5 con un equipo inventado: rival obligatorio, valores del equipo y opcionales plegados. */
const NOW = new Date(2026, 9, 4, 10, 30).getTime();
const team = { periodsCount: 2, periodDurationMs: 25 * 60_000 };
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const isSelected = (el: { props: { accessibilityState?: { selected?: boolean } } }) => el.props.accessibilityState?.selected === true;

async function setup(teamOverride = team) {
  const onContinue = jest.fn();
  const onCancel = jest.fn();
  const screen = await render(<MatchSetupScreen team={teamOverride} now={NOW} onContinue={onContinue} onCancel={onCancel} />);
  return { screen, onContinue, onCancel };
}

describe('MatchSetupScreen (P5)', () => {
  it('propone fecha de ahora y partes × minutos del equipo, con los opcionales plegados', async () => {
    const { screen } = await setup({ periodsCount: 4, periodDurationMs: 12 * 60_000 });
    expect(screen.getByTestId('setup-step')).toHaveTextContent('1 / 3');
    expect(screen.getByTestId('setup-opponent').props.value).toBe('');
    expect(screen.getByTestId('setup-date').props.value).toBe('04/10/2026');
    expect(screen.getByTestId('setup-time').props.value).toBe('10:30');
    expect(isSelected(screen.getByTestId('setup-periods-4'))).toBe(true);
    expect(isSelected(screen.getByTestId('setup-periods-2'))).toBe(false);
    expect(screen.getByTestId('setup-minutes').props.value).toBe('12');
    expect(screen.queryByTestId('setup-more')).toBeNull();
  });

  it('sin rival no continúa: muestra el error solo tras intentarlo', async () => {
    const { screen, onContinue } = await setup();
    expect(screen.queryByTestId('setup-opponent-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-opponent-error')).toHaveTextContent('El rival es obligatorio');
  });

  it('con rival entrega el borrador con los valores del equipo y la fecha local', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), '  CD Rival ');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).toHaveBeenCalledWith({
      opponent: 'CD Rival',
      scheduledAt: NOW,
      periodsCount: 2,
      periodMinutes: 25,
      homeAway: null,
      competition: '',
      matchday: '',
    });
  });

  it('fecha u hora imposibles y minutos fuera de rango bloquean con su mensaje', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), 'CD Rival');
    await fireEvent.changeText(screen.getByTestId('setup-date'), '31/02/2026');
    await fireEvent.changeText(screen.getByTestId('setup-minutes'), '0');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-date-error')).toHaveTextContent(/fecha/);
    expect(screen.getByTestId('setup-minutes-error')).toHaveTextContent(/entre 1 y 90/);

    await fireEvent.changeText(screen.getByTestId('setup-date'), '05/10/2026');
    await fireEvent.changeText(screen.getByTestId('setup-time'), '17:45');
    await fireEvent.changeText(screen.getByTestId('setup-minutes'), '20');
    await fireEvent.press(screen.getByTestId('setup-periods-3'));
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: new Date(2026, 9, 5, 17, 45).getTime(), periodsCount: 3, periodMinutes: 20 }),
    );
  });

  it('Más (opcional) despliega local/visitante (excluyentes y desmarcables), competición y jornada', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.press(screen.getByTestId('setup-more-toggle'));
    expect(screen.getByTestId('setup-more')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('setup-home'));
    await fireEvent.press(screen.getByTestId('setup-away'));
    expect(isSelected(screen.getByTestId('setup-away'))).toBe(true);
    expect(isSelected(screen.getByTestId('setup-home'))).toBe(false);
    await fireEvent.press(screen.getByTestId('setup-away'));
    expect(isSelected(screen.getByTestId('setup-away'))).toBe(false);
    await fireEvent.press(screen.getByTestId('setup-home'));

    await fireEvent.changeText(screen.getByTestId('setup-competition'), ' Liga Prueba ');
    await fireEvent.changeText(screen.getByTestId('setup-matchday'), 'Jornada 3');
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), 'CD Rival');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ homeAway: 'HOME', competition: 'Liga Prueba', matchday: 'Jornada 3' }),
    );
  });

  it('una competición demasiado larga con los opcionales plegados los abre y muestra el error', async () => {
    const { screen, onContinue } = await setup();
    await fireEvent.press(screen.getByTestId('setup-more-toggle'));
    await fireEvent.changeText(screen.getByTestId('setup-competition'), 'c'.repeat(65));
    await fireEvent.changeText(screen.getByTestId('setup-opponent'), 'CD Rival');
    await fireEvent.press(screen.getByTestId('setup-more-toggle'));
    expect(screen.queryByTestId('setup-more')).toBeNull();

    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-competition-error')).toHaveTextContent(/60/);
  });

  it('← llama a onCancel sin entregar nada y los controles principales miden lo que dice docs/05', async () => {
    const { screen, onCancel, onContinue } = await setup();
    expect(flat(screen.getByTestId('setup-continue').props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(screen.getByTestId('setup-periods-2').props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(screen.getByTestId('setup-back').props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(screen.getByTestId('setup-back'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});
