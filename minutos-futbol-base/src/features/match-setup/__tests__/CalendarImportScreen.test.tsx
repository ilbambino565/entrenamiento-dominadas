import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ImportCalendarError, type ImportedCalendar } from '../../shell/importCalendar';
import { CalendarImportScreen } from '../CalendarImportScreen';

const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const result = (count = 30): ImportedCalendar => ({ count, competition: '3ª Liga Inventada, Grupo 9', season: '2030-2031', fixtures: [] });

async function setup(overrides: Partial<React.ComponentProps<typeof CalendarImportScreen>> = {}) {
  const onImport = jest.fn().mockResolvedValue(result());
  const onBack = jest.fn();
  const onGoToTeam = jest.fn();
  const screen = await render(<CalendarImportScreen federationName='C.D. EJEMPLO "A"' onImport={onImport} onBack={onBack} onGoToTeam={onGoToTeam} {...overrides} />);
  return { screen, onImport, onBack, onGoToTeam };
}

describe('CalendarImportScreen', () => {
  it('explica cómo copiar el calendario y a qué equipo busca; IMPORTAR espera a que haya texto', async () => {
    const { screen } = await setup();
    expect(screen.getByTestId('calendar-help')).toHaveTextContent(/Versión resumida/);
    expect(screen.getByTestId('calendar-help')).toHaveTextContent(/C\.D\. EJEMPLO "A"/);
    expect(screen.getByTestId('calendar-import').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), '   ');
    expect(screen.getByTestId('calendar-import').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'Jornada 1 (20-09-2030)');
    expect(screen.getByTestId('calendar-import').props.accessibilityState).toMatchObject({ disabled: false });
    expect(flat(screen.getByTestId('calendar-import').props.style).minHeight).toBeGreaterThanOrEqual(56);
  });

  it('importa el texto tal cual y muestra cuántos partidos se guardaron, con la competición', async () => {
    const { screen, onImport, onBack } = await setup();
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'texto pegado');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(onImport).toHaveBeenCalledWith('texto pegado');
    expect(await screen.findByTestId('calendar-done')).toBeTruthy();
    expect(screen.getByTestId('calendar-done-count')).toHaveTextContent('30 partidos guardados');
    expect(screen.getByTestId('calendar-done-competition')).toHaveTextContent('3ª Liga Inventada, Grupo 9 · 2030-2031');
    await fireEvent.press(screen.getByTestId('calendar-finish'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('un solo partido se dice en singular', async () => {
    const { screen } = await setup({ onImport: jest.fn().mockResolvedValue(result(1)) });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'x');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(await screen.findByTestId('calendar-done-count')).toHaveTextContent('1 partido guardado');
  });

  it('sin partidos del equipo en el texto lo explica y deja reintentar con el texto escrito', async () => {
    const onImport = jest.fn().mockRejectedValue(new ImportCalendarError('NO_MATCHES', 'x'));
    const { screen } = await setup({ onImport });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'texto raro');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(await screen.findByTestId('calendar-error')).toHaveTextContent(/No he encontrado partidos de tu equipo/);
    expect(screen.getByTestId('calendar-input').props.value).toBe('texto raro');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it('un fallo al guardar muestra un mensaje general', async () => {
    const { screen } = await setup({ onImport: jest.fn().mockRejectedValue(new Error('disco lleno')) });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'x');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(await screen.findByTestId('calendar-error')).toHaveTextContent(/No se pudo guardar el calendario/);
  });

  it('mientras importa no se puede pulsar otra vez', async () => {
    let finish: (r: ImportedCalendar) => void = () => undefined;
    const onImport = jest.fn().mockReturnValue(new Promise<ImportedCalendar>((resolve) => (finish = resolve)));
    const { screen } = await setup({ onImport });
    await fireEvent.changeText(screen.getByTestId('calendar-input'), 'x');
    await fireEvent.press(screen.getByTestId('calendar-import'));
    await fireEvent.press(screen.getByTestId('calendar-import'));
    expect(onImport).toHaveBeenCalledTimes(1);
    finish(result());
    expect(await screen.findByTestId('calendar-done')).toBeTruthy();
  });

  it('sin nombre en la federación pide indicarlo y ofrece ir a Equipo, sin campo de texto', async () => {
    const { screen, onGoToTeam } = await setup({ federationName: null });
    expect(screen.getByTestId('calendar-no-name')).toBeTruthy();
    expect(screen.queryByTestId('calendar-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('calendar-go-team'));
    expect(onGoToTeam).toHaveBeenCalledTimes(1);
  });

  it('← llama a onBack', async () => {
    const { screen, onBack } = await setup();
    expect(flat(screen.getByTestId('calendar-back').props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(screen.getByTestId('calendar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
