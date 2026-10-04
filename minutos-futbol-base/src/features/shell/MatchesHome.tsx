import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import crest from '../../../assets/club/escudo-circular-128.png';
import type { SquadService } from '../../app-services/squadService';
import { isValidFormation } from '../../core/formations';
import type { Match } from '../../core/match';
import { formatShortDate } from '../../core/matchSetup';
import { activePlayers, defaultFormationFor, teamMatchConfig } from '../../core/squad';
import type { Team } from '../../core/team';
import { useSquadState } from '../../state';
import { SIZES, useTheme } from '../../ui/theme';

/**
 * P1 "Partidos" mínima (docs/05 §5.3): escudo, nombre del equipo y un botón
 * grande para jugar, que abre el asistente de nuevo partido (P5-P7). La lista
 * y, debajo, los partidos recientes: tocar uno terminado abre su resumen y uno
 * empezado lo reabre. Los que no llegaron a empezar no se pueden abrir.
 */
export interface MatchesHomeProps {
  service: SquadService;
  onPlay: () => void;
  /** Partidos recientes, de más nuevo a más viejo. */
  recent?: readonly Match[];
  onOpenMatch?: (match: Match) => void;
  /** Abre "Importar calendario"; sin él no se muestra el botón. */
  onImportCalendar?: () => void;
}

/** Lo que se ve a la derecha de cada fila y si se puede abrir. */
export function matchRowStatus(match: Match): { label: string; openable: boolean } {
  switch (match.status) {
    case 'FINISHED':
      return { label: '✓', openable: true };
    case 'RUNNING':
    case 'PAUSED':
    case 'HALFTIME':
      return { label: 'en curso', openable: true };
    case 'READY':
      return { label: 'listo', openable: true };
    default:
      return { label: 'sin empezar', openable: false };
  }
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

export function MatchesHome({ service, onPlay, recent = [], onOpenMatch, onImportCalendar }: MatchesHomeProps) {
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
        {onImportCalendar ? (
          <Pressable
            onPress={onImportCalendar}
            accessibilityRole="button"
            accessibilityLabel="Importar calendario"
            testID="import-calendar"
            style={[styles.secondary, { borderColor: colors.accent, backgroundColor: colors.surface }]}
          >
            <Text style={[styles.secondaryText, { color: colors.accent }]}>IMPORTAR CALENDARIO</Text>
          </Pressable>
        ) : null}
        {recent.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]} accessibilityRole="header">
              Recientes
            </Text>
            <FlatList
              data={recent}
              keyExtractor={(m) => m.id}
              testID="recent-matches"
              renderItem={({ item }) => <MatchRow match={item} onOpen={onOpenMatch} />}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function MatchRow({ match, onOpen }: { match: Match; onOpen?: (match: Match) => void }) {
  const { colors } = useTheme();
  const status = matchRowStatus(match);
  const openable = status.openable && onOpen !== undefined;
  return (
    <Pressable
      onPress={() => onOpen?.(match)}
      disabled={!openable}
      accessibilityRole="button"
      accessibilityState={{ disabled: !openable }}
      accessibilityLabel={`${formatShortDate(match.scheduledAt)} contra ${match.opponent}, ${status.label === '✓' ? 'terminado' : status.label}`}
      testID={`match-row-${match.id}`}
      style={[styles.row, { borderBottomColor: colors.surfaceRaised }, !openable && styles.disabled]}
    >
      <Text style={[styles.rowDate, { color: colors.textMuted }]}>{formatShortDate(match.scheduledAt)}</Text>
      <Text numberOfLines={1} style={[styles.rowName, { color: colors.text }]} testID={`match-opponent-${match.id}`}>
        vs {match.opponent}
      </Text>
      <Text style={[styles.rowStatus, { color: colors.textMuted }]} testID={`match-status-${match.id}`}>
        {status.label}
      </Text>
    </Pressable>
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
  secondary: { minHeight: 56, borderRadius: SIZES.radius, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  secondaryText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  hint: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  sectionLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowDate: { width: 72, fontSize: 15, fontWeight: '700' },
  rowName: { flex: 1, fontSize: 17, fontWeight: '600' },
  rowStatus: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
});
