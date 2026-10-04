import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SquadService } from '../../app-services/squadService';
import { displayName } from '../../core/squad';
import type { Player } from '../../core/team';
import { SIZES, useTheme } from '../../ui/theme';
import { BigButton, PRIMARY_HEIGHT, SECONDARY_HEIGHT } from './controls';
import { PlayerAvatar } from './PlayerAvatar';
import { errorMessage, useSquadScreenState } from './useSquadState';

/**
 * P2 "Plantilla" (docs/05 §5.3): lista de la plantilla con avatar, dorsal y
 * nombre; toque → ficha. El orden manual se cambia en un modo "Ordenar" con
 * flechas ▲▼ en vez de arrastre: el arrastre lo monopoliza la pantalla de
 * partido y aquí la precisión importa más que la velocidad (una lista de 14
 * se ordena una vez por temporada). La lista usa siempre el nombre completo:
 * el modo de privacidad del equipo es para las pantallas de partido y las
 * exportaciones; el entrenador, en su plantilla, necesita distinguir a dos
 * "Ana".
 */
export interface SquadScreenProps {
  service: SquadService;
  onAddPlayer: () => void;
  onEditPlayer: (id: string) => void;
  /** Cambia tras cada alta: la lista baja hasta el final para enseñar al jugador nuevo. */
  scrollToEndKey?: number;
}

export function SquadScreen({ service, onAddPlayer, onEditPlayer, scrollToEndKey = 0 }: SquadScreenProps) {
  const { colors } = useTheme();
  const state = useSquadScreenState(service);
  const [reordering, setReordering] = useState(false);
  const listRef = useRef<FlatList<Player>>(null);
  const pendingScroll = useRef(false);
  useEffect(() => {
    if (scrollToEndKey > 0) pendingScroll.current = true;
  }, [scrollToEndKey]);
  const onContentSizeChange = useCallback(() => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    listRef.current?.scrollToEnd({ animated: true });
  }, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const players = state.players;

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      setActionError(null);
      service.movePlayer(id, direction).catch((error: unknown) => setActionError(errorMessage(error, 'No se pudo mover al jugador')));
    },
    [service],
  );

  const toggleReorder = useCallback(() => setReordering((v) => !v), []);

  const renderRow = useCallback(
    ({ item, index }: { item: Player; index: number }) => (
      <PlayerRow
        player={item}
        reordering={reordering}
        isFirst={index === 0}
        isLast={index === players.length - 1}
        onEdit={onEditPlayer}
        onMove={move}
      />
    ),
    [reordering, players.length, onEditPlayer, move],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" testID="squad-title">
          Plantilla ({players.length})
        </Text>
        {players.length > 0 ? (
          <Pressable
            onPress={toggleReorder}
            accessibilityRole="button"
            accessibilityLabel={reordering ? 'Terminar de ordenar' : 'Ordenar la plantilla'}
            accessibilityState={{ selected: reordering }}
            testID="toggle-reorder"
            style={[styles.secondaryButton, { borderColor: colors.accent, backgroundColor: reordering ? colors.accent : colors.surface }]}
          >
            <Text style={[styles.secondaryText, { color: reordering ? colors.onAccent : colors.accent }]}>{reordering ? 'Listo' : 'Ordenar'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onAddPlayer}
          accessibilityRole="button"
          accessibilityLabel="Añadir jugador"
          testID="add-player"
          style={[styles.addButton, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.addText, { color: colors.onAccent }]}>+</Text>
        </Pressable>
      </View>

      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} testID="squad-loading" />
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: colors.danger }]} testID="squad-error">
            {state.error ?? 'No se pudo cargar la plantilla'}
          </Text>
        </View>
      ) : players.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: colors.textMuted }]}>Aún no hay jugadores</Text>
          <View style={styles.emptyButton}>
            <BigButton label="AÑADIR JUGADOR" onPress={onAddPlayer} testID="add-player-empty" />
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={players}
          keyExtractor={(p) => p.id}
          renderItem={renderRow}
          onContentSizeChange={onContentSizeChange}
          extraData={reordering}
          testID="player-list"
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.surfaceRaised }]} />}
        />
      )}
      {actionError ? (
        <Text accessibilityRole="alert" style={[styles.actionError, { color: colors.danger }]} testID="squad-action-error">
          {actionError}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

interface PlayerRowProps {
  player: Player;
  reordering: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

function PlayerRow({ player, reordering, isFirst, isLast, onEdit, onMove }: PlayerRowProps) {
  const { colors } = useTheme();
  const name = displayName(player, 'full');
  const number = player.shirtNumber !== null ? `#${player.shirtNumber}` : '—';
  const label = [
    name,
    player.shirtNumber !== null ? `dorsal ${player.shirtNumber}` : 'sin dorsal',
    player.isGoalkeeper ? 'portero' : null,
    player.isActive ? null : 'inactivo',
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <Pressable
      // En modo Ordenar la fila no navega: un toque en una flecha deshabilitada no debe abrir la ficha.
      onPress={reordering ? undefined : () => onEdit(player.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={reordering ? 'Usa las flechas para cambiar el orden' : 'Toca para editar la ficha'}
      testID={`player-row-${player.id}`}
      style={[styles.row, { backgroundColor: colors.surface }, !player.isActive && styles.inactiveRow]}
    >
      <PlayerAvatar
        photoUri={player.photoUri}
        shirtNumber={player.shirtNumber}
        isGoalkeeper={player.isGoalkeeper}
        initial={player.firstName}
        testID={`player-avatar-${player.id}`}
      />
      <Text style={[styles.number, { color: colors.textMuted }]} testID={`player-number-${player.id}`}>
        {number}
      </Text>
      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]} testID={`player-name-${player.id}`}>
        {name}
      </Text>
      {player.isGoalkeeper ? (
        <Text style={styles.gloves} testID={`player-gk-${player.id}`}>
          🧤
        </Text>
      ) : null}
      {!player.isActive ? (
        <Text style={[styles.inactive, { color: colors.textMuted }]} testID={`player-inactive-${player.id}`}>
          inactivo
        </Text>
      ) : null}
      {reordering ? (
        <View style={styles.moveGroup}>
          <MoveButton direction={-1} disabled={isFirst} name={name} onPress={() => onMove(player.id, -1)} testID={`move-up-${player.id}`} />
          <MoveButton direction={1} disabled={isLast} name={name} onPress={() => onMove(player.id, 1)} testID={`move-down-${player.id}`} />
        </View>
      ) : null}
    </Pressable>
  );
}

interface MoveButtonProps {
  direction: -1 | 1;
  disabled: boolean;
  name: string;
  onPress: () => void;
  testID: string;
}

function MoveButton({ direction, disabled, name, onPress, testID }: MoveButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${direction === -1 ? 'Subir' : 'Bajar'} a ${name}`}
      testID={testID}
      style={[styles.moveButton, { backgroundColor: colors.surfaceRaised }, disabled && styles.moveDisabled]}
    >
      <Text style={[styles.moveText, { color: colors.text }]}>{direction === -1 ? '▲' : '▼'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  title: { flex: 1, fontSize: 24, fontWeight: '800' },
  secondaryButton: {
    minHeight: SECONDARY_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: SECONDARY_HEIGHT / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 15, fontWeight: '700' },
  addButton: {
    minHeight: PRIMARY_HEIGHT,
    minWidth: PRIMARY_HEIGHT,
    borderRadius: PRIMARY_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontSize: 32, lineHeight: 36, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyButton: { alignSelf: 'stretch', marginTop: 20 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  separator: { height: 1 },
  row: {
    minHeight: PRIMARY_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 10,
    borderRadius: SIZES.radius,
  },
  inactiveRow: { opacity: 0.6 },
  number: { width: 40, fontSize: 16, fontWeight: '700' },
  name: { flex: 1, fontSize: 18, fontWeight: '600' },
  gloves: { fontSize: 18 },
  inactive: { fontSize: 14, fontStyle: 'italic' },
  moveGroup: { flexDirection: 'row', gap: 6 },
  moveButton: {
    minHeight: SECONDARY_HEIGHT,
    minWidth: SECONDARY_HEIGHT,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveDisabled: { opacity: 0.3 },
  moveText: { fontSize: 18, fontWeight: '800' },
  actionError: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 14, fontWeight: '600' },
});
