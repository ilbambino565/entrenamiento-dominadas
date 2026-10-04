import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createSquadService, type SquadService } from '../../../app-services/squadService';
import type { PlayerDraft } from '../../../core/team';
import { createInMemorySquadRepository } from '../../../db/inMemorySquadRepository';
import { AppShell } from '../AppShell';
import { firstTeamDraft } from '../FirstRunScreen';

jest.useFakeTimers();
const now = () => Date.now();
const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);

function makeService(): SquadService {
  let n = 0;
  return createSquadService({ repo: createInMemorySquadRepository(), now, newId: () => `id-${String(++n).padStart(3, '0')}` });
}
async function renderShell(service: SquadService): Promise<RenderResult> {
  return render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppShell service={service} now={now} />
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
}
const draft = (firstName: string, o: Partial<PlayerDraft> = {}): PlayerDraft => ({ firstName, lastName: null, shirtNumber: null, isGoalkeeper: false, isActive: true, photoUri: null, photoConsent: false, ...o });
const NAMES = ['Ana', 'Bea', 'Cris', 'Dani', 'Eva', 'Fani', 'Gala', 'Hugo', 'Iris', 'Juan', 'Kai'];

it('repro: alta con 11 → remonta SquadScreen (Ordenar se pierde), el nuevo es el 12.º, la lista arranca sin initialScrollIndex', async () => {
  const service = makeService();
  await service.load();
  await service.createTeam(firstTeamDraft('CD Prueba'));
  for (const [i, n] of NAMES.entries()) await service.addPlayer(draft(n, { shirtNumber: i + 1 }));
  const screen = await renderShell(service);
  await screen.findByTestId('tab-bar');
  await fireEvent.press(screen.getByTestId('tab-squad'));
  expect(await screen.findByTestId('squad-title')).toHaveTextContent('Plantilla (11)');

  // Modo Ordenar activo, luego ir a la ficha de un jugador y volver con ←.
  await fireEvent.press(screen.getByTestId('toggle-reorder'));
  expect(screen.getByTestId('toggle-reorder')).toHaveTextContent('Listo');
  await fireEvent.press(screen.getByTestId('player-row-id-002'));
  expect(screen.queryByTestId('tab-bar')).toBeNull(); // pestañas desmontadas
  await fireEvent.press(screen.getByTestId('back'));
  expect(await screen.findByTestId('toggle-reorder')).toHaveTextContent('Ordenar'); // modo perdido = remontaje

  // Alta: + → nombre → GUARDAR.
  await fireEvent.press(screen.getByTestId('add-player'));
  await fireEvent.changeText(await screen.findByTestId('first-name'), 'Lola');
  await fireEvent.press(screen.getByTestId('save'));
  expect(await screen.findByTestId('squad-title')).toHaveTextContent('Plantilla (12)');

  const list = screen.getByTestId('player-list');
  const rows = screen.getAllByTestId(/^player-row-/);
  // FlatList recién montada: solo la ventana inicial (10 filas); la 12.ª (Lola) ni se renderiza.
  expect(rows).toHaveLength(10);
  expect(list.props.initialScrollIndex).toBeUndefined();
  expect(list.props.data).toHaveLength(12);
  expect(list.props.data[11].firstName).toBe('Lola');
  const lolaId = list.props.data[11].id as string;
  expect(screen.queryByTestId(`player-row-${lolaId}`)).toBeNull();

  // Geometría de fila: minHeight 56, paddingVertical 6, avatar 48 → 60 dp + separador 1.
  const row = flat(rows[0]!.props.style);
  expect(row.minHeight).toBe(56);
  expect(row.paddingVertical).toBe(6);
  const avatar = flat(screen.getByTestId(`player-avatar-${list.props.data[0].id}`).props.style);
  expect(avatar.height).toBe(48);
  const header = flat(screen.getByTestId('squad-title').parent!.props.style);
  expect(header.paddingVertical).toBe(8);
  expect(flat(screen.getByTestId('add-player').props.style).minHeight).toBe(56);
  expect(flat(screen.getByTestId('tab-squad').props.style).minHeight).toBe(64);
  await act(async () => {});
});
