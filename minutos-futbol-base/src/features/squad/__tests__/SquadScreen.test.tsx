import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LIGHT } from '../../../ui/theme';
import { SquadScreen } from '../SquadScreen';
import { createFakeSquadService, makePlayer, type FakeSquadOptions } from './fakeSquadService';

/**
 * P2 con el doble del servicio. RNTL 14 (React 19): `render` y `fireEvent`
 * son asíncronos. Los nombres son inventados.
 */
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) => el.props.accessibilityState?.disabled === true;

const THREE = [
  makePlayer('ana', 'Ana', { lastName: 'García', shirtNumber: 1, isGoalkeeper: true, sortOrder: 0 }),
  makePlayer('bea', 'Bea', { shirtNumber: 5, sortOrder: 1 }),
  makePlayer('cris', 'Cris', { isActive: false, sortOrder: 2 }),
];

async function setup(options: FakeSquadOptions = { players: THREE }) {
  const service = createFakeSquadService(options);
  const onAddPlayer = jest.fn();
  const onEditPlayer = jest.fn();
  const screen = await render(<SquadScreen service={service} onAddPlayer={onAddPlayer} onEditPlayer={onEditPlayer} />);
  return { service, onAddPlayer, onEditPlayer, screen };
}

const rowIds = (screen: RenderResult): string[] =>
  screen.getAllByTestId(/^player-row-/).map((row) => String(row.props.testID).replace('player-row-', ''));

describe('SquadScreen (P2)', () => {
  it('lista la plantilla: cabecera con el total, dorsal o —, nombre completo, 🧤 e "inactivo" atenuado', async () => {
    const { screen, onEditPlayer } = await setup();
    expect(screen.getByTestId('squad-title')).toHaveTextContent('Plantilla (3)');
    expect(rowIds(screen)).toEqual(['ana', 'bea', 'cris']);

    const ana = screen.getByTestId('player-row-ana');
    expect(within(ana).getByTestId('player-number-ana')).toHaveTextContent('#1');
    expect(within(ana).getByTestId('player-name-ana')).toHaveTextContent('Ana García');
    expect(within(ana).getByTestId('player-gk-ana')).toHaveTextContent('🧤');
    expect(screen.queryByTestId('player-gk-bea')).toBeNull();

    const cris = screen.getByTestId('player-row-cris');
    expect(within(cris).getByTestId('player-number-cris')).toHaveTextContent('—');
    expect(within(cris).getByTestId('player-inactive-cris')).toHaveTextContent('inactivo');
    expect(flat(cris.props.style)).toMatchObject({ opacity: 0.6 });
    expect(flat(ana.props.style).opacity).toBeUndefined();
    expect(flat(ana.props.style).minHeight).toBeGreaterThanOrEqual(56);

    // El avatar del portero va en ámbar; el resto en el color del equipo.
    expect(flat(screen.getByTestId('player-avatar-ana').props.style)).toMatchObject({ backgroundColor: LIGHT.colors.amber, width: 48 });
    expect(flat(screen.getByTestId('player-avatar-bea').props.style)).toMatchObject({ backgroundColor: LIGHT.colors.accent });
    expect(screen.getByTestId('player-avatar-bea-label')).toHaveTextContent('5');

    await fireEvent.press(screen.getByTestId('player-row-bea'));
    expect(onEditPlayer).toHaveBeenCalledWith('bea');
    expect(ana.props.accessibilityLabel).toBe('Ana García, dorsal 1, portero');
  });

  it('el botón + mide al menos 56 dp, tiene etiqueta accesible y llama a onAddPlayer', async () => {
    const { screen, onAddPlayer } = await setup();
    const add = screen.getByTestId('add-player');
    expect(add.props.accessibilityLabel).toBe('Añadir jugador');
    expect(flat(add.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(add.props.style).minWidth).toBeGreaterThanOrEqual(56);
    await fireEvent.press(add);
    expect(onAddPlayer).toHaveBeenCalledTimes(1);
  });

  it('estado vacío: texto, botón grande AÑADIR JUGADOR (≥ 56 dp) y sin botón Ordenar', async () => {
    const { screen, onAddPlayer } = await setup({ players: [] });
    expect(screen.getByText('Aún no hay jugadores')).toBeTruthy();
    expect(screen.getByTestId('squad-title')).toHaveTextContent('Plantilla (0)');
    expect(screen.queryByTestId('toggle-reorder')).toBeNull();
    const big = screen.getByTestId('add-player-empty');
    expect(big).toHaveTextContent('AÑADIR JUGADOR');
    expect(flat(big.props.style).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(big);
    expect(onAddPlayer).toHaveBeenCalledTimes(1);
  });

  it('cargando muestra el indicador y pasa a la lista cuando el servicio termina; error muestra el mensaje', async () => {
    const { screen, service } = await setup({ players: THREE, deferLoad: true });
    expect(screen.getByTestId('squad-loading')).toBeTruthy();
    expect(screen.queryByTestId('player-row-ana')).toBeNull();
    await act(async () => {
      service.finishLoad();
    });
    expect(await screen.findByTestId('player-row-ana')).toBeTruthy();

    const failed = createFakeSquadService({ players: [] });
    failed.setState({ status: 'error', error: 'La base de datos está corrupta' });
    const other = await render(<SquadScreen service={failed} onAddPlayer={jest.fn()} onEditPlayer={jest.fn()} />);
    expect(other.getByTestId('squad-error')).toHaveTextContent('La base de datos está corrupta');
    expect(other.queryByText('Aún no hay jugadores')).toBeNull();
  });

  it('Ordenar/Listo: muestra ▲▼ de ≥ 44 dp, deshabilitados en los extremos, que llaman a movePlayer y cambian el orden', async () => {
    const { screen, service } = await setup();
    const movePlayer = jest.spyOn(service, 'movePlayer');
    const toggle = screen.getByTestId('toggle-reorder');
    expect(toggle).toHaveTextContent('Ordenar');
    expect(screen.queryByTestId('move-up-ana')).toBeNull();

    await fireEvent.press(toggle);
    expect(screen.getByTestId('toggle-reorder')).toHaveTextContent('Listo');

    const upAna = screen.getByTestId('move-up-ana');
    const downCris = screen.getByTestId('move-down-cris');
    expect(isDisabled(upAna)).toBe(true);
    expect(isDisabled(downCris)).toBe(true);
    expect(isDisabled(screen.getByTestId('move-down-ana'))).toBe(false);
    expect(isDisabled(screen.getByTestId('move-up-cris'))).toBe(false);
    expect(flat(upAna.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(upAna.props.style).minWidth).toBeGreaterThanOrEqual(44);

    // Los extremos no hacen nada.
    await fireEvent.press(upAna);
    await fireEvent.press(downCris);
    expect(movePlayer).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('move-down-ana'));
    expect(movePlayer).toHaveBeenCalledWith('ana', 1);
    expect(await screen.findByTestId('move-up-ana')).toBeTruthy();
    expect(rowIds(screen)).toEqual(['bea', 'ana', 'cris']);
    // Ahora Bea es la primera: su ▲ se deshabilita y el de Ana se habilita.
    expect(isDisabled(screen.getByTestId('move-up-bea'))).toBe(true);
    expect(isDisabled(screen.getByTestId('move-up-ana'))).toBe(false);

    await fireEvent.press(screen.getByTestId('move-up-cris'));
    expect(movePlayer).toHaveBeenLastCalledWith('cris', -1);
    expect(rowIds(screen)).toEqual(['bea', 'cris', 'ana']);

    await fireEvent.press(screen.getByTestId('toggle-reorder'));
    expect(screen.getByTestId('toggle-reorder')).toHaveTextContent('Ordenar');
    expect(screen.queryByTestId('move-up-ana')).toBeNull();
  });

  it('si movePlayer falla, la pantalla muestra el mensaje del error', async () => {
    const { screen, service } = await setup();
    jest.spyOn(service, 'movePlayer').mockRejectedValue(new Error('Sin espacio en disco'));
    await fireEvent.press(screen.getByTestId('toggle-reorder'));
    await fireEvent.press(screen.getByTestId('move-down-ana'));
    expect(await screen.findByTestId('squad-action-error')).toHaveTextContent('Sin espacio en disco');
  });
});
