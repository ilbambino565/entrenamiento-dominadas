import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import crest from '../../../assets/club/escudo-circular-128.png';
import type { SquadService } from '../../app-services/squadService';
import { isValidFormation } from '../../core/formations';
import { activePlayers, defaultFormationFor, teamMatchConfig } from '../../core/squad';
import type { Team } from '../../core/team';
import { useSquadState } from '../../state';
import { SIZES, useTheme } from '../../ui/theme';

/**
 * P1 "Partidos" mínima (docs/05 §5.3): escudo, nombre del equipo y un botón
 * grande para jugar, que abre el asistente de nuevo partido (P5-P7). La lista
 * de partidos recientes llega en el último paso del hito M4.
 */
export interface MatchesHomeProps {
  service: SquadService;
  onPlay: () => void;
}

/** Más grande que una acción principal normal (56 dp): es EL botón de la app. */
export const PLAY_BUTTON_HEIGHT = 64;

/** Lo que el partido tomará del equipo: jugadores en campo y el dibujo (el del equipo si cuadra con el formato; si no, el de referencia). */
export function plannedFormation(team: Team): { playersOnField: number; formation: string } {
  const { playersOnField } = teamMatchConfig(team);
  const formation =
    team.defaultFormation !== null && isValidFormation(team.defaultFormation, playersOnField)
      ? team.defaultFormation
      : defaultFormationFor(playersOnField);
  return { playersOnField, formation };
}

export function MatchesHome({ service, onPlay }: MatchesHomeProps) {
  const { colors } = useTheme();
  const { team, players } = useSquadState(service);

  if (!team) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        <View style={styles.center}>
          <Text style={[styles.hint, { color: colors.textMuted }]} testID="home-missing">
            Primero crea el equipo
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const active = activePlayers(players).length;
  const { playersOnField, formation } = plannedFormation(team);
  const canPlay = active > 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: colors.surfaceRaised }]}>
        <Image source={crest} style={styles.crest} accessibilityIgnoresInvertColors />
        <View style={styles.titleBlock}>
          <Text style={[styles.teamName, { color: colors.text }]} numberOfLines={1} accessibilityRole="header" testID="home-team-name">
            {team.name}
          </Text>
          {team.category ? (
            <Text style={[styles.category, { color: colors.textMuted }]} numberOfLines={1} testID="home-team-category">
              {team.category}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <Pressable
          onPress={onPlay}
          disabled={!canPlay}
          accessibilityRole="button"
          accessibilityLabel="Jugar partido"
          accessibilityState={{ disabled: !canPlay }}
          testID="play-match"
          style={({ pressed }) => [styles.play, { backgroundColor: pressed ? colors.text : colors.accent }, !canPlay && styles.disabled]}
        >
          <Text style={[styles.playText, { color: colors.onAccent }]}>JUGAR PARTIDO</Text>
        </Pressable>
        {canPlay ? null : (
          <Text style={[styles.hint, { color: colors.textMuted }]} testID="play-hint">
            Añade jugadores en Plantilla
          </Text>
        )}
        <Text style={[styles.note, { color: colors.textMuted }]} testID="play-note">
          Se te pedirá el rival, la fecha y la convocatoria. Juegan {playersOnField} en el campo; la alineación propuesta usa el dibujo
          {formation} y puedes cambiarla antes de iniciar.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  crest: { width: 48, height: 48 },
  titleBlock: { flex: 1 },
  teamName: { fontSize: 22, fontWeight: '800' },
  category: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 24, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  play: {
    minHeight: PLAY_BUTTON_HEIGHT,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  playText: { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
});
