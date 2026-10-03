import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import type { MatchState } from '../../core';
import { useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';
import type { RingTone } from './derived';
import { fieldTokenCenter, fieldTokenMetrics, fitPitch, type Size } from './geometry';
import { DraggablePlayerToken } from './PlayerToken';
import { normalizePosition } from './resolveDrop';
import type { DragController, DragState } from './useDragAndDrop';

export interface TokenView {
  playedMs: number;
  tone: RingTone;
}

export interface PitchProps {
  state: MatchState;
  players: Record<string, PlayerInfo>;
  views: Record<string, TokenView>;
  controller: DragController;
  drag: DragState;
}

/**
 * Campo vertical con las líneas dibujadas con Views. Ocupa el mayor rectángulo
 * que cabe en su hueco (proporción acotada, geometry.ts); las fichas se
 * colocan por su posición normalizada (0..1) con la misma regla y las mismas
 * medidas que usa el imán del drop, y se encogen si el campo es bajo.
 */
export function Pitch({ state, players, views, controller, drag }: PitchProps) {
  const { colors } = useTheme();
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  const size = fitPitch(available);
  // Objeto estable por tamaño: las fichas están memoizadas y lo reciben como prop.
  const metrics = useMemo(() => fieldTokenMetrics(size), [size.width, size.height]);
  const pitchRef = useRef<View>(null);

  // Medir en coordenadas de ventana: lo que `absoluteX/Y` del gesto devuelve.
  const measure = useCallback(() => {
    pitchRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) controller.registerPitch({ x, y, width, height });
    });
  }, [controller]);

  useEffect(() => () => controller.registerPitch(null), [controller]);

  const onOuterLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setAvailable((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    // En web `onLayout` solo salta con un ResizeObserver (tamaño, no posición):
    // si el hueco cambia de alto pero el campo (limitado por el ancho) no, el
    // campo se desplaza centrado sin volver a medirse. El hueco sí se
    // redimensiona siempre en ese caso, así que se mide también desde aquí.
    measure();
  };

  const onFreePress = (e?: GestureResponderEvent) => {
    const native = e?.nativeEvent;
    // Posición relativa al campo por si aún no se ha medido en ventana (o no hay coordenadas).
    const local =
      native && Number.isFinite(native.locationX) && size.width > 0
        ? normalizePosition({ x: native.locationX, y: native.locationY }, { x: 0, y: 0, ...size })
        : { x: 0.5, y: 0.5 };
    const fallback = { kind: 'pitch' as const, position: local };
    if (native && Number.isFinite(native.pageX) && Number.isFinite(native.pageY)) {
      controller.tapPoint({ x: native.pageX, y: native.pageY }, fallback);
    } else {
      controller.tapTarget(fallback);
    }
  };

  const onField = Object.values(state.players).filter((p) => p.location === 'FIELD' && p.position);
  const isDragging = drag.draggingId !== null;
  // Aviso ANTES de soltar (docs/04 §4.2): marco azul = entrará/se moverá aquí;
  // marco rojo = campo lleno, soltar no hará nada. Es una capa aparte para que
  // el borde del campo no cambie de grosor y mueva las fichas.
  const frame = drag.hover?.kind === 'pitch' ? colors.accent : drag.hover?.kind === 'rejected' ? colors.danger : null;

  return (
    <View style={styles.outer} onLayout={onOuterLayout}>
      <Pressable
        ref={pitchRef}
        onLayout={measure}
        onPress={onFreePress}
        accessibilityRole="button"
        accessibilityLabel="Campo"
        accessibilityHint="Con un jugador seleccionado, tócalo para meterlo o recolocarlo"
        testID="pitch"
        style={[styles.pitch, { width: size.width, height: size.height, backgroundColor: colors.grass, borderColor: colors.grassLine }]}
      >
        <PitchLines size={size} color={colors.grassLine} />
        {frame ? <View pointerEvents="none" style={[styles.frame, { borderColor: frame }]} testID="pitch-frame" /> : null}
        {onField.map((p) => {
          const info = players[p.playerId];
          const view = views[p.playerId];
          if (!info || !view || !p.position) return null;
          const center = fieldTokenCenter(p.position, size, metrics);
          const highlighted = drag.hover?.kind === 'token' && drag.hover.playerId === p.playerId;
          return (
            <DraggablePlayerToken
              key={p.playerId}
              controller={controller}
              from="FIELD"
              player={info}
              isGoalkeeper={p.isGoalkeeper}
              unavailable={p.unavailable !== null}
              playedMs={view.playedMs}
              tone={view.tone}
              selected={drag.selectedId === p.playerId}
              highlighted={highlighted}
              dimmed={isDragging && drag.draggingId !== p.playerId && !highlighted}
              dragging={drag.draggingId === p.playerId}
              metrics={metrics}
              onPress={controller.tapToken}
              style={{
                position: 'absolute',
                left: center.x - metrics.columnWidth / 2,
                top: center.y - metrics.radius,
              }}
            />
          );
        })}
      </Pressable>
    </View>
  );
}

/** Líneas reglamentarias aproximadas; no reciben toques. */
function PitchLines({ size, color }: { size: Size; color: string }) {
  const { width: w, height: h } = size;
  if (w === 0) return null;
  const line = { borderColor: color };
  const areaW = w * 0.6;
  const areaH = h * 0.16;
  const goalW = w * 0.3;
  const goalH = h * 0.06;
  const circle = w * 0.28;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.halfway, line, { top: h / 2 - 1 }]} />
      <View style={[styles.circle, line, { width: circle, height: circle, borderRadius: circle / 2, left: w / 2 - circle / 2, top: h / 2 - circle / 2 }]} />
      <View style={[styles.spot, { backgroundColor: color, left: w / 2 - 3, top: h / 2 - 3 }]} />
      <View style={[styles.box, line, { width: areaW, height: areaH, left: (w - areaW) / 2, top: -2 }]} />
      <View style={[styles.box, line, { width: goalW, height: goalH, left: (w - goalW) / 2, top: -2 }]} />
      <View style={[styles.spot, { backgroundColor: color, left: w / 2 - 3, top: h * 0.11 - 3 }]} />
      <View style={[styles.box, line, { width: areaW, height: areaH, left: (w - areaW) / 2, bottom: -2 }]} />
      <View style={[styles.box, line, { width: goalW, height: goalH, left: (w - goalW) / 2, bottom: -2 }]} />
      <View style={[styles.spot, { backgroundColor: color, left: w / 2 - 3, top: h * 0.89 - 3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pitch: { borderWidth: 2, borderRadius: 4, overflow: 'visible' },
  frame: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 4, borderRadius: 2 },
  halfway: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2 },
  circle: { position: 'absolute', borderWidth: 2 },
  spot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  box: { position: 'absolute', borderWidth: 2 },
});
