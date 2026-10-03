import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MatchState } from '../../core';
import { useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';
import { benchElapsedMs } from './derived';
import type { TokenView } from './Pitch';
import { DraggablePlayerToken } from './PlayerToken';
import type { DragController, DragState } from './useDragAndDrop';

export interface BenchProps {
  state: MatchState;
  players: Record<string, PlayerInfo>;
  views: Record<string, TokenView>;
  controller: DragController;
  drag: DragState;
  now: number;
}

/** Banquillo: fichas en orden de convocatoria, dos filas como mucho, sin scroll. */
export function Bench({ state, players, views, controller, drag, now }: BenchProps) {
  const { colors } = useTheme();
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) controller.registerBench({ x, y, width, height });
    });
  }, [controller]);

  useEffect(() => () => controller.registerBench(null), [controller]);

  const benchIds = [...state.config.squad, ...Object.keys(state.players)]
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => state.players[id]?.location === 'BENCH');
  const lit = drag.hover?.kind === 'bench';
  const isDragging = drag.draggingId !== null;

  return (
    <Pressable
      ref={ref}
      onLayout={measure}
      onPress={() => controller.tapTarget({ kind: 'bench' })}
      accessibilityRole="button"
      accessibilityLabel="Banquillo"
      accessibilityHint="Con un jugador del campo seleccionado, tócalo para sacarlo"
      testID="bench"
      style={[styles.bench, { backgroundColor: lit ? colors.benchHighlight : colors.surface, borderColor: colors.surfaceRaised }]}
    >
      {/* Marco de 4 dp en capa aparte: el tinte solo no se ve al sol y un borde en flujo movería las fichas. */}
      {lit ? <View pointerEvents="none" style={[styles.frame, { borderColor: colors.accent }]} testID="bench-frame" /> : null}
      <Text style={[styles.title, { color: colors.textMuted }]}>BANQUILLO</Text>
      <View style={styles.row}>
        {benchIds.map((id) => {
          const info = players[id];
          const p = state.players[id];
          const view = views[id];
          if (!info || !p || !view) return null;
          const elapsed = benchElapsedMs(state, id, now);
          return (
            <DraggablePlayerToken
              key={id}
              controller={controller}
              from="BENCH"
              player={info}
              isGoalkeeper={p.isGoalkeeper}
              unavailable={p.unavailable !== null}
              playedMs={view.playedMs}
              tone={view.tone}
              selected={drag.selectedId === id}
              highlighted={false}
              dimmed={isDragging && drag.draggingId !== id}
              dragging={drag.draggingId === id}
              footnote={elapsed === null ? null : `⏱ ${Math.floor(elapsed / 60_000)}'`}
              onPress={controller.tapToken}
            />
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bench: { borderTopWidth: 2, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  frame: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 4 },
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  // Sin `overflow: hidden`: la ficha arrastrada es hija de esta fila y se
  // desplaza por `transform`, así que recortar la fila la haría desaparecer en
  // cuanto el dedo sube hacia el campo (el gesto principal). Con ≤ 9 suplentes
  // caben en dos filas; si hubiera más, el banquillo crece y el campo encoge.
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
