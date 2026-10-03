import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MatchEngine } from '../../app-services/matchEngine';
import { formatClock, periodClockMs, type LineupEntry, type MatchState } from '../../core';
import { TABULAR, useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';
import { guarded, type Notify } from './guard';
import { UndoButton } from './UndoButton';

export interface ClockBarProps {
  engine: MatchEngine;
  state: MatchState;
  now: number;
  players: Record<string, PlayerInfo>;
  rival: string;
  notify: Notify;
  onOpenSummary: () => void;
}

const LONG_PRESS_MS = 800;

/** Botón principal según el estado (docs/03 §3.1): solo el siguiente paso lógico. */
function mainAction(state: MatchState, engine: MatchEngine, onOpenSummary: () => void): { label: string; run: () => Promise<unknown> | void } {
  switch (state.status) {
    case 'READY':
      return { label: 'INICIAR', run: () => engine.start() };
    case 'RUNNING':
      return { label: 'PAUSA', run: () => engine.pause() };
    case 'PAUSED':
      return { label: 'REANUDAR', run: () => engine.resume() };
    case 'HALFTIME':
      return { label: `${state.currentPeriod + 1}ª PARTE`, run: () => engine.startNextPeriod() };
    case 'FINISHED':
      return { label: 'RESUMEN', run: onOpenSummary };
    case 'DRAFT': {
      // Tras deshacer la alineación el partido vuelve a DRAFT: se confirma la
      // que haya en el campo para no dejar al entrenador sin salida.
      const field: LineupEntry[] = Object.values(state.players)
        .filter((p) => p.location === 'FIELD' && p.position)
        .map((p) => ({ playerId: p.playerId, position: p.position ?? { x: 0.5, y: 0.5 }, goalkeeper: p.isGoalkeeper }));
      const bench = Object.values(state.players)
        .filter((p) => p.location === 'BENCH')
        .map((p) => p.playerId);
      return { label: 'CONFIRMAR', run: () => engine.setLineup(field, bench) };
    }
  }
}

function periodLabel(state: MatchState, blinkOn: boolean): { text: string; dim: boolean } {
  switch (state.status) {
    case 'RUNNING':
      return { text: `${state.currentPeriod}ª`, dim: false };
    case 'PAUSED':
      return { text: 'PAUSA', dim: !blinkOn };
    case 'HALFTIME':
      return { text: 'DESCANSO', dim: false };
    case 'FINISHED':
      return { text: 'FINAL', dim: false };
    default:
      return { text: 'LISTO', dim: false };
  }
}

export function ClockBar({ engine, state, now, players, rival, notify, onOpenSummary }: ClockBarProps) {
  const { colors, sizes } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!menuOpen) setHint(false);
  }, [menuOpen]);

  const clock = formatClock(engine.clockMs(now));
  // Parpadeo suave sin Animated: la opacidad alterna con cada tick.
  const period = periodLabel(state, Math.floor(now / 1000) % 2 === 0);
  const extraMs =
    state.status === 'RUNNING' || state.status === 'PAUSED'
      ? periodClockMs(state.clockSegments, state.currentPeriod, now) - state.config.periodDurationMs
      : 0;

  const main = mainAction(state, engine, onOpenSummary);
  const canHalftime = (state.status === 'RUNNING' || state.status === 'PAUSED') && state.currentPeriod < state.config.periodsCount;
  const canEnd = state.status === 'RUNNING' || state.status === 'PAUSED' || state.status === 'HALFTIME';
  // Cortar el partido en el descanso es suspenderlo (docs/03 §3.1): queda
  // registrado como tal y el resumen lo marca.
  const suspending = state.status === 'HALFTIME';

  const runMain = () => {
    const result = main.run();
    if (result) void guarded(() => result, notify, main.label.toLowerCase());
  };

  const halftime = () => {
    setMenuOpen(false);
    void guarded(() => engine.startHalftime(), notify, 'el descanso');
  };

  const end = async () => {
    setMenuOpen(false);
    if (await guarded(() => engine.end(suspending ? 'SUSPENDED' : 'NORMAL'), notify, 'el final')) onOpenSummary();
  };

  const holdButton = (label: string, onHold: () => void, testID: string) => (
    <Pressable
      onPress={() => setHint(true)}
      onLongPress={onHold}
      delayLongPress={LONG_PRESS_MS}
      accessibilityRole="button"
      accessibilityLabel={`${label}, mantén pulsado`}
      testID={testID}
      style={({ pressed }) => [
        styles.holdButton,
        { minHeight: sizes.buttonHeight, borderColor: colors.danger, backgroundColor: pressed ? colors.surfaceRaised : colors.surface },
      ]}
    >
      <Text style={[styles.holdText, { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.surfaceRaised }]}>
      <View style={styles.top}>
        <View style={styles.titleBlock}>
          <Text style={[styles.rival, { color: colors.text }]}>vs {rival}</Text>
          <View style={styles.clockRow}>
            <Text style={[styles.clock, TABULAR, { color: colors.text, fontSize: sizes.clockFont }]} testID="clock">
              {clock}
            </Text>
            <View>
              <Text style={[styles.period, { color: colors.accent, opacity: period.dim ? 0.3 : 1 }]} testID="period">
                {period.text}
              </Text>
              {extraMs > 0 ? (
                <Text style={[styles.extra, TABULAR, { color: colors.danger }]} testID="added-time">
                  +{formatClock(extraMs)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <UndoButton engine={engine} state={state} players={players} notify={notify} />
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={runMain}
          accessibilityRole="button"
          testID="main-button"
          style={({ pressed }) => [
            styles.main,
            { minHeight: sizes.buttonHeight, backgroundColor: pressed ? colors.text : colors.accent },
          ]}
        >
          <Text style={[styles.mainText, { color: colors.onAccent }]}>{main.label}</Text>
        </Pressable>
        <Pressable
          onPress={() => setMenuOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Más acciones"
          testID="menu-button"
          style={[styles.menu, { minHeight: sizes.buttonHeight, borderColor: colors.surfaceRaised }]}
        >
          <Text style={[styles.menuText, { color: colors.text }]}>⋯</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={styles.menuRow}>
          {canHalftime ? holdButton('DESCANSO', halftime, 'halftime-button') : null}
          {canEnd ? holdButton(suspending ? 'SUSPENDER' : 'FINALIZAR', () => void end(), 'end-button') : null}
          {!canHalftime && !canEnd ? <Text style={{ color: colors.textMuted }}>Sin acciones en este estado</Text> : null}
          {hint && (canHalftime || canEnd) ? (
            <Text style={[styles.hint, { color: colors.textMuted }]} testID="hold-hint">
              mantén pulsado
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, borderBottomWidth: 2 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  titleBlock: { flex: 1 },
  rival: { fontSize: 15, fontWeight: '600' },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clock: { fontWeight: '800', lineHeight: 64 },
  period: { fontSize: 20, fontWeight: '800' },
  extra: { fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  main: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mainText: { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  menu: { width: 64, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 26, fontWeight: '800' },
  menuRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 },
  holdButton: { flexGrow: 1, borderWidth: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  holdText: { fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  hint: { width: '100%', fontSize: 13, textAlign: 'center' },
});
