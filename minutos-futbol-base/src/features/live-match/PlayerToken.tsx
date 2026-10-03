import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { formatClock, type PlayerLocation } from '../../core';
import { TABULAR, useTheme } from '../../ui/theme';
import type { PlayerInfo } from './demoTeam';
import type { RingTone } from './derived';
import { TOKEN_COLUMN_WIDTH, TOKEN_NAME_HEIGHT, TOKEN_SIZE } from './geometry';
import { useDraggableToken, type DragController } from './useDragAndDrop';

/**
 * Ficha de jugador: círculo con la foto (o el dorsal grande si no la hay) y el
 * tiempo jugado, y el nombre en una pastilla debajo. Memoizada: recibe todo
 * calculado por el padre, que es el único suscrito al tick; así solo cambian
 * los textos que de verdad cambian.
 *
 * Por qué así y no "nombre / tiempo / %" bajo el círculo: la columna mide 84 dp
 * (docs: geometry.ts) para que las filas de una alineación no se pisen en un
 * móvil, y ningún texto queda directamente sobre el césped (el verde no llega
 * a AA con el texto del tema; docs/05 §5.4 pide alto contraste al sol). El %
 * no se pinta en P8: el anillo ya codifica el reparto y P9 lo lista.
 */
export interface PlayerTokenProps {
  player: PlayerInfo;
  /** Dónde está: cambia el halo (solo sobre césped) y la etiqueta accesible. */
  location: PlayerLocation;
  isGoalkeeper: boolean;
  unavailable: boolean;
  playedMs: number;
  tone: RingTone;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  dragging: boolean;
  /** Línea pequeña bajo la ficha (tiempo en el banquillo). `null` reserva el hueco; ausente no lo pinta. */
  footnote?: string | null;
  onPress: (playerId: string) => void;
  testID?: string;
}

export const PlayerToken = memo(function PlayerToken(props: PlayerTokenProps) {
  const { player, location, isGoalkeeper, unavailable, playedMs, tone, selected, highlighted, dimmed, dragging, footnote } = props;
  const { colors } = useTheme();
  const ring = tone === 'low' ? colors.neutralRing : tone === 'high' ? colors.amber : colors.accent;
  const fill = isGoalkeeper ? colors.amber : colors.accent;
  const onFill = isGoalkeeper ? colors.onAmber : colors.onAccent;
  const borderColor = selected ? colors.text : highlighted ? colors.grassLine : ring;
  const borderWidth = selected || highlighted ? 5 : 3;
  const onField = location === 'FIELD';
  const where = onField ? 'en el campo' : 'en el banquillo';
  const injured = unavailable ? ', lesionado' : '';
  const photo = player.photoUri;

  return (
    <Pressable
      onPress={() => props.onPress(player.id)}
      accessibilityRole="button"
      accessibilityLabel={`${player.name}, dorsal ${player.number}, ${where}, ${formatClock(playedMs)} jugados${injured}`}
      accessibilityHint="Toca para seleccionar y luego toca el destino"
      accessibilityState={{ selected }}
      testID={props.testID ?? `token-${player.id}`}
      style={[styles.column, dimmed && styles.dimmed, dragging && styles.dragging]}
    >
      <View style={styles.circleBox}>
        {/* Halo claro de 2 dp: el azul/ámbar no se separa del césped (≈1,6:1); el halo sí (≥ 4:1). */}
        {onField ? <View testID={`token-halo-${player.id}`} style={[styles.halo, { backgroundColor: colors.grassLine }]} /> : null}
        <View style={[styles.circle, { backgroundColor: fill, borderColor, borderWidth }]}>
          {photo ? (
            <>
              <View style={styles.photoClip}>
                <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" testID={`token-photo-${player.id}`} />
              </View>
              {/* Con foto, el dorsal pasa a una chapa pequeña y el tiempo a una banda inferior oscura. */}
              <View style={[styles.numberBadge, isGoalkeeper && { backgroundColor: colors.amber }]}>
                <Text style={[styles.numberBadgeText, isGoalkeeper && { color: colors.onAmber }]}>{player.number}</Text>
              </View>
              <View style={styles.timeBand}>
                <Text style={[styles.timeOnPhoto, TABULAR]} testID={`token-time-${player.id}`}>
                  {formatClock(playedMs)}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.number, { color: onFill }]}>{player.number}</Text>
              <Text style={[styles.time, TABULAR, { color: onFill }]} testID={`token-time-${player.id}`}>
                {formatClock(playedMs)}
              </Text>
            </>
          )}
          {unavailable ? <Text style={styles.badge}>🩹</Text> : null}
        </View>
      </View>
      <View style={[styles.namePill, { backgroundColor: colors.surface }]} testID={`token-name-${player.id}`}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {player.name}
        </Text>
      </View>
      {footnote !== undefined ? (
        <Text style={[styles.footnote, TABULAR, { color: colors.textMuted }]}>{footnote ?? ''}</Text>
      ) : null}
    </Pressable>
  );
});

export interface DraggablePlayerTokenProps extends Omit<PlayerTokenProps, 'location'> {
  controller: DragController;
  from: PlayerLocation;
  /** Posición (absoluta en el campo) o nada (banquillo). */
  style?: StyleProp<ViewStyle>;
}

/** Ficha + gesto de arrastre. El desplazamiento se anima en el hilo UI. */
export function DraggablePlayerToken({ controller, from, style, ...token }: DraggablePlayerTokenProps) {
  const { pan, style: animated } = useDraggableToken(controller, token.player.id, from);
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, animated, token.dragging && styles.onTop]}>
        <PlayerToken {...token} location={from} />
      </Animated.View>
    </GestureDetector>
  );
}

const HALO = 2;
const OVERLAY = 'rgba(15, 23, 42, 0.74)';

const styles = StyleSheet.create({
  column: { width: TOKEN_COLUMN_WIDTH, alignItems: 'center' },
  dimmed: { opacity: 0.6 },
  dragging: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  onTop: { zIndex: 20 },
  // El halo va en una vista aparte para no tocar TOKEN_SIZE, que es el radio del imán.
  circleBox: { width: TOKEN_SIZE, height: TOKEN_SIZE },
  halo: {
    position: 'absolute',
    left: -HALO,
    top: -HALO,
    width: TOKEN_SIZE + 2 * HALO,
    height: TOKEN_SIZE + 2 * HALO,
    borderRadius: (TOKEN_SIZE + 2 * HALO) / 2,
  },
  circle: {
    width: TOKEN_SIZE,
    height: TOKEN_SIZE,
    borderRadius: TOKEN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Recorte circular dentro del borde; el 🩹 queda fuera de este recorte.
  photoClip: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: TOKEN_SIZE / 2, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  numberBadge: {
    position: 'absolute',
    left: 0,
    top: 0,
    minWidth: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: OVERLAY,
    alignItems: 'center',
  },
  numberBadgeText: { color: '#ffffff', fontSize: 11, lineHeight: 16, fontWeight: '800' },
  timeBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 1,
    backgroundColor: OVERLAY,
    borderBottomLeftRadius: TOKEN_SIZE / 2,
    borderBottomRightRadius: TOKEN_SIZE / 2,
    alignItems: 'center',
  },
  timeOnPhoto: { color: '#ffffff', fontSize: 12, lineHeight: 14, fontWeight: '700' },
  number: { fontSize: 20, lineHeight: 22, fontWeight: '800' },
  time: { fontSize: 14, lineHeight: 16, fontWeight: '700' },
  badge: { position: 'absolute', right: -4, top: -4, fontSize: 16 },
  namePill: {
    height: TOKEN_NAME_HEIGHT,
    marginTop: 2,
    paddingHorizontal: 6,
    borderRadius: TOKEN_NAME_HEIGHT / 2,
    maxWidth: TOKEN_COLUMN_WIDTH,
    justifyContent: 'center',
  },
  name: { fontSize: 13, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase' },
  footnote: { fontSize: 11, lineHeight: 13, marginTop: 1, minHeight: 13 },
});
