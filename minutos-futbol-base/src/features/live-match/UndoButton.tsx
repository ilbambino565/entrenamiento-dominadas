import { Pressable, StyleSheet, Text } from 'react-native';
import type { MatchEngine } from '../../app-services/matchEngine';
import type { MatchState } from '../../core';
import { useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';
import { guarded, type Notify } from './guard';
import { describeUndo } from './undoLabel';

export interface UndoButtonProps {
  engine: MatchEngine;
  /** No se lee: cambia con cada evento y fuerza a releer `peekUndo()`. */
  state: MatchState;
  players: Record<string, PlayerInfo>;
  notify: Notify;
}

/**
 * DESHACER siempre visible con lo que va a deshacer (docs/03 §3.5). Se pasa
 * el id mostrado al motor: si entre tanto entró otro gesto, el motor rechaza
 * y el rótulo ya se habrá actualizado con el nuevo último evento.
 */
export function UndoButton({ engine, players, notify }: UndoButtonProps) {
  const { colors, sizes } = useTheme();
  const target = engine.peekUndo();
  const label = target ? describeUndo(target, players) : 'Nada que deshacer';

  return (
    <Pressable
      disabled={!target}
      onPress={() => {
        if (target) void guarded(() => engine.undo(undefined, target.id), notify, 'el deshacer');
      }}
      accessibilityRole="button"
      accessibilityLabel={`Deshacer: ${label}`}
      accessibilityState={{ disabled: !target }}
      testID="undo"
      style={[styles.button, { minHeight: sizes.buttonHeight, borderColor: colors.surfaceRaised, opacity: target ? 1 : 0.45 }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>↶ DESHACER</Text>
      <Text numberOfLines={1} style={[styles.detail, { color: colors.textMuted }]} testID="undo-label">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderRadius: 12, maxWidth: 170 },
  title: { fontSize: 15, fontWeight: '800' },
  detail: { fontSize: 12, marginTop: 1 },
});
