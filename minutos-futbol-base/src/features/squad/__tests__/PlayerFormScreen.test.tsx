import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SquadError } from '../../../app-services/squadService';
import { LIGHT } from '../../../ui/theme';
import { DELETE_EXPLANATION, PlayerFormScreen, parseShirtNumber } from '../PlayerFormScreen';
import { pickPlayerPhoto } from '../photoPicker';
import { createFakeSquadService, makePlayer, type FakeSquadOptions } from './fakeSquadService';

/**
 * P3 con el doble del servicio y el selector de fotos mockeado (la galería no
 * existe en Jest). Nombres inventados; la "foto" es un data URI de juguete.
 */
jest.mock('../photoPicker', () => ({ pickPlayerPhoto: jest.fn(), PHOTO_SIZE: 256 }));

const pick = pickPlayerPhoto as jest.MockedFunction<typeof pickPlayerPhoto>;
const PHOTO = 'data:image/jpeg;base64,QUJD';
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);
const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) => el.props.accessibilityState?.disabled === true;

const ANA = makePlayer('ana', 'Ana', { lastName: 'García', shirtNumber: 1, isGoalkeeper: true, sortOrder: 0 });
const BEA = makePlayer('bea', 'Bea', { lastName: 'Soler', shirtNumber: 5, isActive: false, sortOrder: 1 });

async function setup(playerId: string | null = null, options: FakeSquadOptions = { players: [ANA, BEA] }) {
  const service = createFakeSquadService(options);
  const onDone = jest.fn();
  const screen = await render(<PlayerFormScreen service={service} playerId={playerId} onDone={onDone} />);
  return { service, onDone, screen };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

beforeEach(() => {
  pick.mockReset();
});

describe('PlayerFormScreen (P3) — alta', () => {
  it('alta válida: llama a addPlayer con el borrador normalizado y luego a onDone', async () => {
    const { screen, service, onDone } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    expect(screen.getByTestId('player-form-title')).toHaveTextContent('Nuevo jugador');
    expect(screen.getByTestId('active').props.value).toBe(true);
    expect(screen.getByTestId('goalkeeper').props.value).toBe(false);
    expect(screen.getByTestId('shirt-number').props.keyboardType).toBe('number-pad');

    await fireEvent.changeText(screen.getByTestId('first-name'), '  Dani ');
    await fireEvent.changeText(screen.getByTestId('last-name'), 'Pérez  ');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '9');
    await fireEvent(screen.getByTestId('goalkeeper'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('save'));
    await flush();

    expect(addPlayer).toHaveBeenCalledTimes(1);
    expect(addPlayer).toHaveBeenCalledWith({
      firstName: 'Dani',
      lastName: 'Pérez',
      shirtNumber: 9,
      isGoalkeeper: true,
      isActive: true,
      photoUri: null,
      photoConsent: false,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(service.getState().players.map((p) => p.firstName)).toEqual(['Ana', 'Bea', 'Dani']);
  });

  it('apellidos y dorsal vacíos se guardan como null', async () => {
    const { screen, service } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(addPlayer).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Eva', lastName: null, shirtNumber: null }));
  });

  it('nombre vacío bloquea: no llama al servicio, muestra el error en rojo bajo el campo y no cierra', async () => {
    const { screen, service, onDone } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    // Antes de tocar nada la ficha no está en rojo.
    expect(screen.queryByText('El nombre es obligatorio')).toBeNull();

    await fireEvent.press(screen.getByTestId('save'));
    const issue = screen.getByTestId('issue-firstName-REQUIRED');
    expect(issue).toHaveTextContent('El nombre es obligatorio');
    expect(flat(issue.props.style)).toMatchObject({ color: LIGHT.colors.danger });
    expect(addPlayer).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    // Al escribir el nombre, el error desaparece en vivo.
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    expect(screen.queryByTestId('issue-firstName-REQUIRED')).toBeNull();
  });

  it('dorsal repetido: aviso en ámbar que no impide guardar', async () => {
    const { screen, service, onDone } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '1');

    const warning = screen.getByTestId('issue-shirtNumber-DUPLICATE_NUMBER');
    expect(warning).toHaveTextContent('Ya hay otro jugador con el dorsal 1');
    expect(flat(warning.props.style)).toMatchObject({ color: LIGHT.colors.amber });

    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(addPlayer).toHaveBeenCalledWith(expect.objectContaining({ shirtNumber: 1 }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('dorsal fuera de rango o no numérico bloquea con el mensaje del dominio', async () => {
    const { screen, service } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '100');
    expect(screen.getByTestId('issue-shirtNumber-RANGE')).toHaveTextContent(/entre 0 y 99/);
    await fireEvent.press(screen.getByTestId('save'));
    expect(addPlayer).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('shirt-number'), '1a');
    expect(screen.getByTestId('issue-shirtNumber-RANGE')).toBeTruthy();
    expect(parseShirtNumber('1a')).toBeNaN();
    expect(parseShirtNumber(' ')).toBeNull();
    expect(parseShirtNumber('07')).toBe(7);
  });

  it('foto sin consentimiento bloquea; con consentimiento guarda el data URI', async () => {
    pick.mockResolvedValue(PHOTO);
    const { screen, service, onDone } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.queryByTestId('remove-photo')).toBeNull();

    await fireEvent.press(screen.getByTestId('photo-button'));
    await flush();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('photo-preview').props.source).toEqual({ uri: PHOTO });
    expect(screen.getByTestId('remove-photo')).toHaveTextContent('Quitar foto');

    // Al elegir foto el campo cuenta como tocado: el error del consentimiento se ve ya.
    const issue = screen.getByTestId('issue-photo-PHOTO_WITHOUT_CONSENT');
    expect(issue).toHaveTextContent('Para guardar la foto hace falta el consentimiento de la familia');
    expect(flat(issue.props.style)).toMatchObject({ color: LIGHT.colors.danger });

    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(addPlayer).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    const consent = screen.getByTestId('consent');
    expect(consent.props.accessibilityRole).toBe('checkbox');
    expect(consent.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(consent);
    expect(screen.getByTestId('consent').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('issue-photo-PHOTO_WITHOUT_CONSENT')).toBeNull();

    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(addPlayer).toHaveBeenCalledWith(expect.objectContaining({ photoUri: PHOTO, photoConsent: true }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Quitar foto deja photoUri a null; cancelar el selector no cambia nada; un error del selector se muestra', async () => {
    pick.mockResolvedValueOnce(PHOTO).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Sin permiso para abrir la galería'));
    const { screen, service } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');

    await fireEvent.press(screen.getByTestId('photo-button'));
    await flush();
    expect(screen.getByTestId('photo-preview')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('remove-photo'));
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.queryByTestId('remove-photo')).toBeNull();

    await fireEvent.press(screen.getByTestId('photo-button'));
    await flush();
    expect(screen.queryByTestId('photo-preview')).toBeNull();

    await fireEvent.press(screen.getByTestId('photo-button'));
    await flush();
    expect(screen.getByTestId('photo-error')).toHaveTextContent('Sin permiso para abrir la galería');

    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(addPlayer).toHaveBeenCalledWith(expect.objectContaining({ photoUri: null }));
  });

  it('si el servicio rechaza con SquadError muestra sus issues (o el mensaje) y vuelve a habilitar GUARDAR', async () => {
    const { screen, service, onDone } = await setup();
    const issue = { field: 'firstName' as const, code: 'TOO_LONG' as const, level: 'error' as const, message: 'Nombre demasiado largo' };
    jest
      .spyOn(service, 'addPlayer')
      .mockRejectedValueOnce(new SquadError('VALIDATION', 'La ficha tiene errores', [issue]))
      .mockRejectedValueOnce(new SquadError('STORAGE', 'No se pudo escribir en la base de datos'));
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');

    await fireEvent.press(screen.getByTestId('save'));
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Nombre demasiado largo');
    expect(isDisabled(screen.getByTestId('save'))).toBe(false);

    await fireEvent.press(screen.getByTestId('save'));
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('No se pudo escribir en la base de datos');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('GUARDAR mide al menos 56 dp y ← llama a onDone sin guardar', async () => {
    const { screen, service, onDone } = await setup();
    const addPlayer = jest.spyOn(service, 'addPlayer');
    expect(flat(screen.getByTestId('save').props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(screen.getByTestId('photo-button').props.style)).toMatchObject({ width: 96, height: 96 });
    await fireEvent.changeText(screen.getByTestId('first-name'), 'Eva');
    await fireEvent.press(screen.getByTestId('back'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(addPlayer).not.toHaveBeenCalled();
  });
});

describe('PlayerFormScreen (P3) — edición', () => {
  it('precarga los valores del jugador y updatePlayer recibe el borrador completo normalizado', async () => {
    const { screen, service, onDone } = await setup('bea');
    const updatePlayer = jest.spyOn(service, 'updatePlayer');
    expect(screen.getByTestId('player-form-title')).toHaveTextContent('Jugador');
    expect(screen.getByTestId('first-name').props.value).toBe('Bea');
    expect(screen.getByTestId('last-name').props.value).toBe('Soler');
    expect(screen.getByTestId('shirt-number').props.value).toBe('5');
    expect(screen.getByTestId('active').props.value).toBe(false);
    expect(screen.getByTestId('goalkeeper').props.value).toBe(false);
    expect(screen.getByTestId('delete')).toHaveTextContent('Eliminar jugador');

    await fireEvent.changeText(screen.getByTestId('shirt-number'), '6');
    await fireEvent(screen.getByTestId('active'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('save'));
    await flush();

    expect(updatePlayer).toHaveBeenCalledWith('bea', {
      firstName: 'Bea',
      lastName: 'Soler',
      shirtNumber: 6,
      isGoalkeeper: false,
      isActive: true,
      photoUri: null,
      photoConsent: false,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('al editar, el propio dorsal no cuenta como repetido', async () => {
    const { screen } = await setup('ana');
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '1');
    expect(screen.queryByTestId('issue-shirtNumber-DUPLICATE_NUMBER')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('shirt-number'), '5');
    expect(screen.getByTestId('issue-shirtNumber-DUPLICATE_NUMBER')).toHaveTextContent(/dorsal 5/);
  });

  it('eliminar en dos pasos: explica qué se borra, SÍ, ELIMINAR llama a removePlayer y a onDone; Cancelar vuelve atrás', async () => {
    const { screen, service, onDone } = await setup('bea');
    const removePlayer = jest.spyOn(service, 'removePlayer');
    expect(screen.queryByTestId('confirm-delete')).toBeNull();

    const del = screen.getByTestId('delete');
    expect(flat(del.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(del);
    expect(removePlayer).not.toHaveBeenCalled();
    expect(screen.getByText(DELETE_EXPLANATION)).toBeTruthy();
    expect(screen.getByText('Se borran su nombre y su foto; sus minutos pasados se conservan')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('cancel-delete'));
    expect(screen.queryByTestId('confirm-delete')).toBeNull();
    expect(screen.getByTestId('delete')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('delete'));
    const confirm = screen.getByTestId('confirm-delete');
    expect(confirm).toHaveTextContent('SÍ, ELIMINAR');
    expect(flat(confirm.props.style)).toMatchObject({ backgroundColor: LIGHT.colors.danger });
    expect(flat(confirm.props.style).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(confirm);
    await flush();

    expect(removePlayer).toHaveBeenCalledWith('bea');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(service.getState().players.map((p) => p.id)).toEqual(['ana']);
  });

  it('con la foto precargada, Quitar foto y guardar deja photoUri a null', async () => {
    const withPhoto = makePlayer('cris', 'Cris', { photoUri: PHOTO, photoConsent: true, sortOrder: 0 });
    const { screen, service } = await setup('cris', { players: [withPhoto] });
    const updatePlayer = jest.spyOn(service, 'updatePlayer');
    expect(screen.getByTestId('photo-preview').props.source).toEqual({ uri: PHOTO });
    expect(screen.getByTestId('consent').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('remove-photo'));
    await fireEvent.press(screen.getByTestId('save'));
    await flush();
    expect(updatePlayer).toHaveBeenCalledWith('cris', expect.objectContaining({ photoUri: null, photoConsent: true }));
  });

  it('un id desconocido muestra "Jugador no encontrado"; mientras carga, el indicador', async () => {
    const { screen, onDone } = await setup('zzz');
    expect(screen.getByTestId('player-missing')).toHaveTextContent('Jugador no encontrado');
    await fireEvent.press(screen.getByTestId('back'));
    expect(onDone).toHaveBeenCalledTimes(1);

    const { screen: loading } = await setup('bea', { players: [ANA, BEA], deferLoad: true });
    expect(loading.getByTestId('player-loading')).toBeTruthy();
  });
});
