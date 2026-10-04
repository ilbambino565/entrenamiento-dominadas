import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMatchSession } from '../../app-services/createMatchSession';
import { buildDefaultLineup, toPlayerInfo, type LineupEntry } from '../../core';
import type { DisplayNameMode, Player, Team } from '../../core/team';
import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { useMatchState } from '../../state';
import { useTheme } from '../../ui/theme';
import { Bench } from '../live-match/Bench';
import { prepareMatch } from '../live-match/createDemoSession';
import type { PlayerInfo } from '../live-match/demoTeam';
import type { TokenView } from '../live-match/Pitch';
import { Pitch } from '../live-match/Pitch';
import { Toast, useToast } from '../live-match/Toast';
import { useDragAndDrop } from '../live-match/useDragAndDrop';
import { BigButton, SECONDARY_HEIGHT } from '../squad/controls';
import { fieldCount, lineupFromState } from './lineupFromState';

/**
 * P7 "Nuevo partido · 3 Alineación" (docs/05 §5.3): el campo y el banquillo
 * de P8, con los convocados y los titulares por defecto ya puestos, para
 * moverlos antes del pitido. Usa un motor PROPIO en memoria (el borrador no
 * se guarda: un gesto aquí no es un evento del partido). INICIAR PARTIDO
 * entrega titulares y banquillo tal como han quedado; con menos titulares
 * que jugadores en campo avisa pero deja seguir, sin ninguno no continúa.
 */
export interface LineupScreenProps {
  team: Pick<Team, 'defaultFormation' | 'periodsCount' | 'periodDurationMs'> & { displayNameMode: DisplayNameMode };
  /** La plantilla completa; se usan solo los convocados. */
  players: readonly Player[];
  /** Convocados (P6), en orden de plantilla. */
  convocated: readonly string[];
  playersOnField: number;
  onStart: (lineup: LineupEntry[], bench: string[]) => void;
  onBack: () => void;
}

export function LineupScreen({ team, players, convocated, playersOnField, onStart, onBack }: LineupScreenProps) {
  const { colors } = useTheme();
  const squadPlayers = useMemo(() => {
    const chosen = new Set(convocated);
    return players.filter((p) => chosen.has(p.id));
  }, [players, convocated]);
  const info = useMemo(() => {
    const out: Record<string, PlayerInfo> = {};
    for (const p of squadPlayers) out[p.id] = toPlayerInfo(p, team.displayNameMode);
    return out;
  }, [squadPlayers, team.displayNameMode]);

  // El motor del borrador nace con la pantalla y se libera al salir.
  const session = useMemo(
    () =>
      createMatchSession({
        config: {
          matchId: 'lineup-draft',
          playersOnField,
          periodsCount: team.periodsCount,
          periodDurationMs: team.periodDurationMs,
          squad: squadPlayers.map((p) => p.id),
        },
        store: createInMemoryEventStore(),
        cameraSettings: null,
      }),
    [squadPlayers, playersOnField, team.periodsCount, team.periodDurationMs],
  );
  useEffect(() => () => void session.dispose(), [session]);

  const { engine } = session;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const state = useMatchState(engine);
  const toast = useToast();
  const { controller, drag } = useDragAndDrop(engine, toast.show);

  useEffect(() => {
    let alive = true;
    const { lineup, bench } = buildDefaultLineup(team, squadPlayers, playersOnField);
    prepareMatch(session, lineup, bench)
      .then(() => alive && setReady(true))
      .catch((error: unknown) => {
        console.error('[Lineup] no se pudo preparar la alineación', error);
        if (alive) setLoadError('No se pudo preparar la alineación');
      });
    return () => {
      alive = false;
    };
  }, [session, team, squadPlayers, playersOnField]);

  // Sin tiempos que comparar: todas las fichas en tono neutro.
  const views = useMemo(() => {
    const out: Record<string, TokenView> = {};
    for (const id of Object.keys(info)) out[id] = { playedMs: 0, tone: 'even' };
    return out;
  }, [info]);

  if (!ready) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        {loadError ? (
          <Text style={{ color: colors.danger }} testID="lineup-error">
            {loadError}
          </Text>
        ) : (
          <ActivityIndicator color={colors.accent} testID="lineup-loading" />
        )}
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver" testID="lineup-back" style={styles.back}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const onField = fieldCount(state);
  const missing = playersOnField - onField;
  const blocked = onField === 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver" testID="lineup-back" style={styles.back}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Alineación
        </Text>
        <Text style={[styles.count, { color: colors.textMuted }]} testID="lineup-count">
          {onField} / {playersOnField}
        </Text>
        <Text style={[styles.step, { color: colors.textMuted }]} testID="lineup-step">
          3 / 3
        </Text>
      </View>

      <View style={[styles.pitchArea, drag.draggingFrom === 'FIELD' && styles.onTop]}>
        <Pitch state={state} players={info} views={views} controller={controller} drag={drag} />
      </View>
      <View style={drag.draggingFrom === 'BENCH' ? styles.onTop : undefined}>
        <Bench state={state} players={info} views={views} controller={controller} drag={drag} now={0} />
      </View>

      <View style={styles.footer}>
        {blocked || missing > 0 ? (
          <Text
            accessibilityRole="alert"
            testID="lineup-issue"
            style={[styles.issue, { color: blocked ? colors.danger : colors.textMuted }]}
          >
            {blocked ? 'Pon al menos un jugador en el campo' : `Faltan ${missing} para completar el campo de ${playersOnField}`}
          </Text>
        ) : null}
        <BigButton
          label="INICIAR PARTIDO"
          onPress={() => {
            const { lineup, bench } = lineupFromState(state);
            onStart(lineup, bench);
          }}
          testID="lineup-start"
          disabled={blocked}
        />
      </View>
      <Toast message={toast.message} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { minWidth: SECONDARY_HEIGHT, minHeight: SECONDARY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, fontWeight: '700' },
  title: { flex: 1, fontSize: 22, fontWeight: '800', paddingHorizontal: 4 },
  count: { fontSize: 16, fontWeight: '800', paddingHorizontal: 6 },
  step: { fontSize: 15, fontWeight: '700', paddingHorizontal: 6 },
  pitchArea: { flex: 1, paddingVertical: 8, paddingHorizontal: 12 },
  onTop: { zIndex: 10, elevation: 10 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  issue: { marginBottom: 8, fontSize: 14, fontWeight: '600' },
});
