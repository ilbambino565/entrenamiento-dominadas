import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { formationsFor } from '../../../core/formations';
import { TeamScreen, parsePeriodMinutes } from '../TeamScreen';
import { createFakeSquadService, makeTeam, type FakeSquadOptions } from './fakeSquadService';

/** P4 mínima con el doble del servicio. Los chips guardan al tocar; los textos al perder el foco o con GUARDAR. */
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const isSelected = (el: { props: { accessibilityState?: { selected?: boolean } } }) => el.props.accessibilityState?.selected === true;

async function setup(options: FakeSquadOptions = {}) {
  const service = createFakeSquadService(options);
  const updateTeam = jest.spyOn(service, 'updateTeam');
  const screen = await render(<TeamScreen service={service} />);
  return { service, updateTeam, screen };
}

describe('TeamScreen (P4)', () => {
  it('sin equipo muestra "Primero crea el equipo"', async () => {
    const { screen } = await setup({ team: null });
    expect(screen.getByTestId('team-missing')).toHaveTextContent('Primero crea el equipo');
    expect(screen.queryByTestId('team-name')).toBeNull();
  });

  it('precarga nombre, categoría, formato, dibujo Auto, partes × minutos y modo de nombres', async () => {
    const { screen } = await setup({ team: makeTeam({ name: 'CD Prueba', category: 'Alevín', defaultFormation: '3-1-2', displayNameMode: 'first_initial' }) });
    expect(screen.getByTestId('team-name').props.value).toBe('CD Prueba');
    expect(screen.getByTestId('team-category').props.value).toBe('Alevín');
    expect(isSelected(screen.getByTestId('format-F7'))).toBe(true);
    expect(isSelected(screen.getByTestId('format-F11'))).toBe(false);
    expect(isSelected(screen.getByTestId('formation-3-1-2'))).toBe(true);
    expect(isSelected(screen.getByTestId('formation-auto'))).toBe(false);
    expect(screen.getByTestId('period-count')).toHaveTextContent('2');
    expect(screen.getByTestId('period-minutes').props.value).toBe('25');
    expect(screen.getByTestId('period-minutes').props.keyboardType).toBe('number-pad');
    expect(isSelected(screen.getByTestId('names-first_initial'))).toBe(true);
    for (const f of formationsFor(7)) expect(screen.getByTestId(`formation-${f}`)).toBeTruthy();
    expect(screen.queryByTestId('formation-4-4-2')).toBeNull();
  });

  it('los chips de formato guardan al tocar y, si el dibujo ya no cuadra, vuelve a Auto y cambian los dibujos ofrecidos', async () => {
    const { screen, updateTeam } = await setup({ team: makeTeam({ defaultFormation: '2-3-1' }) });
    expect(flat(screen.getByTestId('format-F7').props.style).minHeight).toBeGreaterThanOrEqual(44);

    await fireEvent.press(screen.getByTestId('format-F11'));
    expect(updateTeam).toHaveBeenCalledWith({ defaultFormat: 'F11', defaultFormation: null });
    expect(await screen.findByTestId('formation-4-4-2')).toBeTruthy();
    expect(isSelected(screen.getByTestId('format-F11'))).toBe(true);
    expect(isSelected(screen.getByTestId('formation-auto'))).toBe(true);
    expect(screen.queryByTestId('formation-2-3-1')).toBeNull();

    // Tocar el formato ya elegido no escribe nada.
    await fireEvent.press(screen.getByTestId('format-F11'));
    expect(updateTeam).toHaveBeenCalledTimes(1);
  });

  it('los chips de dibujo y de modo de nombres guardan al tocar', async () => {
    const { screen, updateTeam, service } = await setup();
    await fireEvent.press(screen.getByTestId('formation-3-2-1'));
    expect(updateTeam).toHaveBeenCalledWith({ defaultFormation: '3-2-1' });
    expect(await screen.findByTestId('formation-3-2-1')).toBeTruthy();
    expect(isSelected(screen.getByTestId('formation-3-2-1'))).toBe(true);

    await fireEvent.press(screen.getByTestId('formation-auto'));
    expect(updateTeam).toHaveBeenLastCalledWith({ defaultFormation: null });

    await fireEvent.press(screen.getByTestId('names-first'));
    expect(updateTeam).toHaveBeenLastCalledWith({ displayNameMode: 'first' });
    expect(await screen.findByTestId('names-first')).toBeTruthy();
    expect(isSelected(screen.getByTestId('names-first'))).toBe(true);
    expect(isSelected(screen.getByTestId('names-full'))).toBe(false);
    expect(service.getState().team).toMatchObject({ defaultFormation: null, displayNameMode: 'first' });
  });

  it('el nombre se guarda al perder el foco (recortado) y la categoría y los minutos con GUARDAR; sin cambios no escribe', async () => {
    const { screen, updateTeam } = await setup();
    expect(flat(screen.getByTestId('save-team').props.style).minHeight).toBeGreaterThanOrEqual(56);

    await fireEvent.changeText(screen.getByTestId('team-name'), '  Nuevo CF ');
    await fireEvent(screen.getByTestId('team-name'), 'blur');
    expect(updateTeam).toHaveBeenCalledWith({ name: 'Nuevo CF' });

    await fireEvent.changeText(screen.getByTestId('team-category'), 'Benjamín');
    await fireEvent.changeText(screen.getByTestId('period-minutes'), '30');
    await fireEvent.press(screen.getByTestId('save-team'));
    expect(updateTeam).toHaveBeenLastCalledWith({ category: 'Benjamín', periodDurationMs: 30 * 60_000 });

    await fireEvent.press(screen.getByTestId('save-team'));
    expect(updateTeam).toHaveBeenCalledTimes(2);

    // Categoría vacía → null.
    await fireEvent.changeText(screen.getByTestId('team-category'), '   ');
    await fireEvent(screen.getByTestId('team-category'), 'blur');
    expect(updateTeam).toHaveBeenLastCalledWith({ category: null });
  });

  it('nombre vacío o minutos inválidos no se guardan y muestran el motivo', async () => {
    const { screen, updateTeam } = await setup();
    await fireEvent.changeText(screen.getByTestId('team-name'), '   ');
    await fireEvent.press(screen.getByTestId('save-team'));
    expect(screen.getByTestId('team-save-error')).toHaveTextContent('El nombre del equipo es obligatorio');

    await fireEvent.changeText(screen.getByTestId('team-name'), 'CD Prueba');
    await fireEvent.changeText(screen.getByTestId('period-minutes'), '0');
    await fireEvent.press(screen.getByTestId('save-team'));
    expect(screen.getByTestId('team-save-error')).toHaveTextContent(/entre 1 y 90/);
    expect(updateTeam).not.toHaveBeenCalled();

    expect(parsePeriodMinutes('25')).toBe(1_500_000);
    expect(parsePeriodMinutes('91')).toBeNull();
    expect(parsePeriodMinutes('abc')).toBeNull();
  });

  it('si updateTeam falla, se muestra el mensaje', async () => {
    const { screen, updateTeam } = await setup();
    updateTeam.mockRejectedValueOnce(new Error('Disco lleno'));
    await fireEvent.press(screen.getByTestId('names-first'));
    expect(await screen.findByTestId('team-save-error')).toHaveTextContent('Disco lleno');
  });
});
