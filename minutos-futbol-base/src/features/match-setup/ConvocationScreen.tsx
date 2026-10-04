import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { convocablePlayers, defaultConvocation, keepConvocable, toggleConvocation, validateConvocation } from '../../core/convocation';
import { displayName } from '../../core/squad';
import type { DisplayNameMode, Player } from '../../core/team';
import { useTheme } from '../../ui/theme';
import { PlayerAvatar } from '../squad/PlayerAvatar';
import { BigButton, Chip, ChipRow, SECONDARY_HEIGHT } from '../squad/controls';

/**
 * P6 "Nuevo partido · 2 Convocatoria" (docs/05 §5.3): lista de jugadores
 * activos con todos marcados por defecto; toda la fila es tocable. Entrega los
 * ids convocados en orden de plantilla. Sin nadie marcado no continúa; con
 * menos que jugadores en campo avisa pero deja seguir.
 */
export interface ConvocationScreenProps {
  /** La plantilla completa: la pantalla filtra activos y eliminados. */
  players: readonly Player[];
  displayNameMode: DisplayNameMode;
  playersOnField: number;
  /** Selección inicial (al volver desde la alineación); por defecto, todos. */
  initialSelected?: readonly string[];
  onContinue: (selectedIds: string[]) => void;
  onBack: () => void;
}

export function ConvocationScreen({ players, displayNameMode, playersOnField, initialSelected, onContinue, onBack }: ConvocationScreenProps) {
  const { colors } = useTheme();
  const candidates = useMemo(() => convocablePlayers(players), [players]);
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelected ? keepConvocable(players, initialSelected) : defaultConvocation(players),
  );
  const [submitted, setSubmitted] = useState(false);

  const issue = validateConvocation(selected.length, playersOnField);
  const showIssue = issue !== null && (issue.level === 'warning' || submitted);
  const chosen = new Set(selected);

  const submit = () => {
    setSubmitted(true);
    if (issue?.level === 'error') return;
    onContinue(selected);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver" testID="convocation-back" style={styles.back}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Convocatoria
        </Text>
        <Text style={[styles.count, { color: colors.textMuted }]} testID="convocation-count">
          {selected.length} / {candidates.length}
        </Text>
        <Text style={[styles.step, { color: colors.textMuted }]} testID="convocation-step">
          2 / 3
        </Text>
      </View>

      <View style={styles.bulk}>
        <ChipRow>
          <Chip label="Todos" selected={false} onPress={() => setSelected(defaultConvocation(players))} testID="convocation-all" />
          <Chip label="Ninguno" selected={false} onPress={() => setSelected([])} testID="convocation-none" />
        </ChipRow>
      </View>

      {candidates.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]} testID="convocation-empty">
          No hay jugadores activos en la plantilla
        </Text>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(p) => p.id}
          extraData={selected}
          testID="convocation-list"
          renderItem={({ item }) => (
            <Row
              player={item}
              name={displayName(item, displayNameMode)}
              checked={chosen.has(item.id)}
              onPress={() => setSelected((current) => toggleConvocation(players, current, item.id))}
            />
          )}
        />
      )}

      <View style={styles.footer}>
        {showIssue && issue ? (
          <Text
            accessibilityRole="alert"
            testID="convocation-issue"
            style={[styles.issue, { color: issue.level === 'error' ? colors.danger : colors.textMuted }]}
          >
            {issue.message}
          </Text>
        ) : null}
        <BigButton label="ALINEACIÓN  →" onPress={submit} testID="convocation-continue" accessibilityLabel="Alineación" disabled={candidates.length === 0} />
      </View>
    </SafeAreaView>
  );
}

function Row({ player, name, checked, onPress }: { player: Player; name: string; checked: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={name}
      testID={`convocation-row-${player.id}`}
      style={[styles.row, { borderBottomColor: colors.neutralRing }]}
    >
      <Text style={[styles.box, { color: checked ? colors.accent : colors.textMuted }]} testID={`convocation-box-${player.id}`}>
        {checked ? '☑' : '☐'}
      </Text>
      <PlayerAvatar photoUri={player.photoUri} shirtNumber={player.shirtNumber} isGoalkeeper={player.isGoalkeeper} initial={player.firstName} size={40} testID={`convocation-avatar-${player.id}`} />
      <Text style={[styles.number, { color: colors.textMuted }]}>{player.shirtNumber !== null ? `#${player.shirtNumber}` : ''}</Text>
      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]} testID={`convocation-name-${player.id}`}>
        {name}
      </Text>
      {player.isGoalkeeper ? <Text accessibilityLabel="Portero">🧤</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { minWidth: SECONDARY_HEIGHT, minHeight: SECONDARY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, fontWeight: '700' },
  title: { flex: 1, fontSize: 22, fontWeight: '800', paddingHorizontal: 4 },
  count: { fontSize: 16, fontWeight: '800', paddingHorizontal: 6 },
  step: { fontSize: 15, fontWeight: '700', paddingHorizontal: 6 },
  bulk: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  box: { fontSize: 26, width: 30, textAlign: 'center' },
  number: { width: 36, fontSize: 15, fontWeight: '700' },
  name: { flex: 1, fontSize: 18, fontWeight: '600' },
  empty: { padding: 24, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  issue: { marginBottom: 8, fontSize: 14, fontWeight: '600' },
});
