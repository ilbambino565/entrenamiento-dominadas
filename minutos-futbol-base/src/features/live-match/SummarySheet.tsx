import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MatchEngine } from '../../app-services/matchEngine';
import { formatClock, substitutionLog, type MatchState } from '../../core';
import { TABULAR, useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';

export interface SummarySheetProps {
  visible: boolean;
  onClose: () => void;
  engine: MatchEngine;
  state: MatchState;
  players: Record<string, PlayerInfo>;
  rival: string;
  now: number;
}

/** Resumen P9 básico: tabla en orden de convocatoria, máx/mín/media y cambios. */
export function SummarySheet({ visible, onClose, engine, state, players, rival, now }: SummarySheetProps) {
  const { colors, sizes } = useTheme();
  if (!visible) return null;

  const summary = engine.summary(now);
  // Solo cambios con el partido en marcha: un cambio en READY (periodo 0) es una
  // edición de la alineación para el reductor (sin entrada ni intervalo) y
  // listarlo como "00:00 ↓ A ↑ B" contradiría la columna Tit. de arriba.
  const changes = substitutionLog(engine.getTimeline()).filter((c) => c.period > 0);
  const nameOf = (id: string | null) => (id && players[id]?.name) || id || '?';
  const minutes = Math.round(state.config.periodDurationMs / 60_000);

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.background }]} testID="summary">
        <Text style={[styles.title, { color: colors.text }]}>Resumen · vs {rival}</Text>
        <Text style={[styles.subtitle, TABULAR, { color: colors.textMuted }]}>
          {state.config.periodsCount}×{minutes} · {formatClock(summary.clockMs)} real
          {state.endReason === 'SUSPENDED' ? ' · suspendido' : ''}
        </Text>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.row, styles.header]}>
            <Text style={[styles.player, styles.head, { color: colors.textMuted }]}>Jugador</Text>
            <Text style={[styles.cell, styles.head, { color: colors.textMuted }]}>Min</Text>
            <Text style={[styles.cellSmall, styles.head, { color: colors.textMuted }]}>%</Text>
            <Text style={[styles.cellSmall, styles.head, { color: colors.textMuted }]}>Ent.</Text>
            <Text style={[styles.cellSmall, styles.head, { color: colors.textMuted }]}>Tit.</Text>
          </View>
          {summary.players.map((p) => {
            const info = players[p.playerId];
            return (
              <View key={p.playerId} style={[styles.row, { borderColor: colors.surfaceRaised }]} testID={`summary-row-${p.playerId}`}>
                <Text style={[styles.player, { color: colors.text }]}>
                  #{info?.number ?? '?'} {info?.name ?? p.playerId}
                </Text>
                <Text style={[styles.cell, TABULAR, { color: colors.text }]}>{formatClock(p.playedMs)}</Text>
                <Text style={[styles.cellSmall, TABULAR, { color: colors.text }]}>{Math.round(p.share * 100)}%</Text>
                <Text style={[styles.cellSmall, TABULAR, { color: colors.text }]}>{p.entries}</Text>
                <Text style={[styles.cellSmall, { color: colors.text }]}>{p.wasStarter ? '●' : ''}</Text>
              </View>
            );
          })}
          <Text style={[styles.stats, TABULAR, { color: colors.text }]}>
            Máx {formatClock(summary.maxMs)} · Mín {formatClock(summary.minMs)} · Media {formatClock(summary.avgMs)}
          </Text>
          <Text style={[styles.section, { color: colors.textMuted }]}>Cambios</Text>
          {changes.length === 0 ? <Text style={{ color: colors.textMuted }}>Sin cambios</Text> : null}
          {changes.map((c) => (
            <Text key={c.eventId} style={[styles.change, TABULAR, { color: colors.text }]}>
              {formatClock(c.matchTimeMs)}
              {c.outPlayerId ? `  ↓ ${nameOf(c.outPlayerId)}` : ''}
              {c.inPlayerId ? `  ↑ ${nameOf(c.inPlayerId)}` : ''}
            </Text>
          ))}
        </ScrollView>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          testID="summary-close"
          style={[styles.close, { minHeight: sizes.buttonHeight, backgroundColor: colors.accent }]}
        >
          <Text style={[styles.closeText, { color: colors.onAccent }]}>CERRAR</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 16, paddingTop: 48, paddingBottom: 24 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { fontSize: 14, marginBottom: 12 },
  content: { paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  header: { borderBottomWidth: 0 },
  head: { fontSize: 12, fontWeight: '700' },
  player: { flex: 1, fontSize: 16, fontWeight: '600' },
  cell: { width: 64, fontSize: 16, textAlign: 'right' },
  cellSmall: { width: 48, fontSize: 15, textAlign: 'right' },
  stats: { marginTop: 14, fontSize: 15, fontWeight: '600' },
  section: { marginTop: 16, marginBottom: 4, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  change: { fontSize: 15, paddingVertical: 3 },
  close: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  closeText: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
});
