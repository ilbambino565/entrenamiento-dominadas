import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatClock } from '../../core';
import type { MatchStatus } from '../../core/state';
import { useTheme } from '../../ui/theme';
import { BigButton } from '../squad';

/**
 * P0 "Hay un partido en curso" (docs/05 §5.3): rival, parte, reloj y estado
 * del partido recuperado y un único botón enorme, CONTINUAR PARTIDO.
 */
export interface ResumeMatchScreenProps {
  rival: string;
  currentPeriod: number;
  status: MatchStatus;
  clockMs: number;
  onContinue: () => void;
}

const STATUS_TEXT: Partial<Record<MatchStatus, string>> = {
  RUNNING: 'en marcha',
  PAUSED: 'en pausa',
  HALFTIME: 'descanso',
};

export function ResumeMatchScreen({ rival, currentPeriod, status, clockMs, onContinue }: ResumeMatchScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={styles.ball} accessibilityElementsHidden importantForAccessibility="no">
        ⚽
      </Text>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Hay un partido en curso
      </Text>
      <View style={styles.details}>
        <Text style={[styles.line, { color: colors.text }]} testID="resume-match-line">
          {rival === '' ? 'Partido' : `vs ${rival}`} · {currentPeriod}ª parte
        </Text>
        <Text style={[styles.line, { color: colors.textMuted }]} testID="resume-clock-line">
          Reloj: {formatClock(clockMs)} ({STATUS_TEXT[status] ?? status})
        </Text>
      </View>
      <View style={styles.button}>
        <BigButton label="CONTINUAR PARTIDO" onPress={onContinue} testID="resume-continue" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  ball: { fontSize: 48 },
  title: { fontSize: 24, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  details: { marginTop: 16, gap: 6, alignItems: 'center' },
  line: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 32 },
});
