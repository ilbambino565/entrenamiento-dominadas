import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MatchSession } from '../../app-services/createMatchSession';
import { useMatchState, useNow } from '../../state';
import { useTheme } from '../../ui/theme';
import { Bench } from './Bench';
import { ClockBar } from './ClockBar';
import { DEMO_BENCH, DEMO_LINEUP, DEMO_TEAM_NAME, prepareMatch } from './createDemoSession';
import type { PlayerInfo } from './demoTeam';
import type { LineupEntry } from '../../core';
import { ringTone } from './derived';
import { Pitch, type TokenView } from './Pitch';
import { SummarySheet } from './SummarySheet';
import { Toast, useToast } from './Toast';
import { useDragAndDrop } from './useDragAndDrop';

export interface LiveMatchScreenProps {
  session: MatchSession;
  players: Record<string, PlayerInfo>;
  rival?: string;
  teamName?: string;
  /** Alineación inicial (por defecto, la del equipo de prueba). */
  lineup?: readonly LineupEntry[];
  bench?: readonly string[];
  /**
   * Volver al inicio. Lo ofrece el menú ⋯ (SALIR, solo antes del pitido o con
   * el partido terminado) y el resumen (VOLVER AL INICIO). Sin él la pantalla
   * no tiene salida, como hasta ahora en la demo.
   */
  onExit?: () => void;
}

/**
 * P8 "Partido en vivo" (docs/05 §5.3): reloj arriba, campo en el centro,
 * banquillo abajo. Todo cabe en una pantalla; nada hace scroll. La pantalla
 * es la única suscrita al tick: calcula los tiempos de todos una vez por
 * segundo y se los pasa ya hechos a las fichas (memoizadas).
 */
export function LiveMatchScreen({
  session,
  players,
  rival = 'CD Rival',
  teamName = DEMO_TEAM_NAME,
  lineup = DEMO_LINEUP,
  bench = DEMO_BENCH,
  onExit,
}: LiveMatchScreenProps) {
  const { engine } = session;
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const state = useMatchState(engine);
  const now = useNow(1000);
  const toast = useToast();
  const notify = toast.show;
  const { controller, drag } = useDragAndDrop(engine, notify);

  useEffect(() => {
    let alive = true;
    prepareMatch(session, lineup, bench)
      .then(() => alive && setReady(true))
      .catch((error: unknown) => {
        console.error('[LiveMatch] no se pudo preparar el partido', error);
        if (alive) setLoadError('No se pudo cargar el partido');
      });
    return () => {
      alive = false;
    };
  }, [session, lineup, bench]);

  // Un solo resumen por tick para todos: tiempos y tono del anillo (frente a la media).
  const views = useMemo<Record<string, TokenView>>(() => {
    const summary = engine.summary(now);
    const out: Record<string, TokenView> = {};
    for (const p of summary.players) out[p.playerId] = { playedMs: p.playedMs, tone: ringTone(p.playedMs, summary.avgMs) };
    return out;
  }, [engine, now, state]);

  const openSummary = useCallback(() => setSummaryOpen(true), []);
  const closeSummary = useCallback(() => setSummaryOpen(false), []);

  if (!ready) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        {loadError ? <Text style={{ color: colors.danger }}>{loadError}</Text> : <ActivityIndicator color={colors.accent} />}
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>{loadError ? '' : 'Preparando el partido…'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ClockBar
        engine={engine}
        state={state}
        now={now}
        players={players}
        rival={rival}
        teamName={teamName}
        notify={notify}
        onOpenSummary={openSummary}
        onExit={onExit}
      />
      {/* Quien arrastra se pone por encima del otro contenedor para no quedar tapado. */}
      <View style={[styles.pitchArea, drag.draggingFrom === 'FIELD' && styles.onTop]}>
        <Pitch state={state} players={players} views={views} controller={controller} drag={drag} />
      </View>
      <View style={drag.draggingFrom === 'BENCH' ? styles.onTop : undefined}>
        <Bench state={state} players={players} views={views} controller={controller} drag={drag} now={now} />
      </View>
      <Toast message={toast.message} />
      <SummarySheet visible={summaryOpen} onClose={closeSummary} onExit={onExit} engine={engine} state={state} players={players} rival={rival} now={now} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pitchArea: { flex: 1, paddingVertical: 8, paddingHorizontal: 12 },
  onTop: { zIndex: 10, elevation: 10 },
});
