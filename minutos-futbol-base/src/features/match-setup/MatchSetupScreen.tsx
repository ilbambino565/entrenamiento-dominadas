import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HomeAway } from '../../core/match';
import {
  PERIODS_COUNT_OPTIONS,
  COMPETITION_MAX_LENGTH,
  MATCHDAY_MAX_LENGTH,
  OPPONENT_MAX_LENGTH,
  defaultMatchSetup,
  formatDateText,
  formatTimeText,
  normalizeMatchSetup,
  parseDateTime,
  parseMinutes,
  validateMatchSetup,
  type MatchSetupDraft,
  type MatchSetupField,
} from '../../core/matchSetup';
import type { Team } from '../../core/team';
import { useTheme } from '../../ui/theme';
import { BigButton, Chip, ChipRow, FormField, SECONDARY_HEIGHT } from '../squad/controls';

/**
 * P5 "Nuevo partido · 1 Datos" (docs/05 §5.3): rival (obligatorio), fecha y
 * hora, partes × minutos y, plegado, local/visitante, competición y jornada.
 * Parte de los valores del equipo y no guarda nada: al pulsar CONVOCATORIA
 * entrega el borrador normalizado y válido (el partido se crea más adelante,
 * al iniciarlo). Los errores solo aparecen tras intentar continuar.
 */
export interface MatchSetupScreenProps {
  team: Pick<Team, 'periodsCount' | 'periodDurationMs'>;
  /** Recibe el borrador ya normalizado y válido. */
  onContinue: (draft: MatchSetupDraft) => void;
  onCancel: () => void;
  /** Reloj inyectable: fecha inicial propuesta. */
  now?: number;
}

export function MatchSetupScreen({ team, onContinue, onCancel, now }: MatchSetupScreenProps) {
  const { colors } = useTheme();
  const initial = useMemo(() => defaultMatchSetup(team, now ?? Date.now()), [team, now]);
  const [opponent, setOpponent] = useState(initial.opponent);
  const [dateText, setDateText] = useState(formatDateText(initial.scheduledAt ?? 0));
  const [timeText, setTimeText] = useState(formatTimeText(initial.scheduledAt ?? 0));
  const [periodsCount, setPeriodsCount] = useState(initial.periodsCount);
  const [minutesText, setMinutesText] = useState(String(initial.periodMinutes ?? ''));
  const [homeAway, setHomeAway] = useState<HomeAway | null>(null);
  const [competition, setCompetition] = useState('');
  const [matchday, setMatchday] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const draft: MatchSetupDraft = {
    opponent,
    scheduledAt: parseDateTime(dateText, timeText),
    periodsCount,
    periodMinutes: parseMinutes(minutesText),
    homeAway,
    competition,
    matchday,
  };
  const issues = validateMatchSetup(draft);
  const messageFor = (field: MatchSetupField): string | null =>
    submitted ? (issues.find((i) => i.field === field)?.message ?? null) : null;

  const submit = () => {
    setSubmitted(true);
    if (issues.length > 0) {
      // Los opcionales con error están plegados: se abren para que se vea el motivo.
      if (issues.some((i) => i.field === 'competition' || i.field === 'matchday')) setMoreOpen(true);
      return;
    }
    onContinue(normalizeMatchSetup(draft));
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Volver" testID="setup-back" style={styles.back}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Nuevo partido
        </Text>
        <Text style={[styles.step, { color: colors.textMuted }]} testID="setup-step">
          1 / 3
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="Rival *" value={opponent} onChangeText={setOpponent} testID="setup-opponent" maxLength={OPPONENT_MAX_LENGTH + 10} autoFocus placeholder="CD Rival" />
        <FieldError message={messageFor('opponent')} testID="setup-opponent-error" />

        <View style={styles.row}>
          <View style={styles.grow}>
            <FormField label="Fecha" value={dateText} onChangeText={setDateText} testID="setup-date" keyboardType="numbers-and-punctuation" autoCapitalize="none" placeholder="dd/mm/aaaa" />
          </View>
          <View style={styles.timeBox}>
            <FormField label="Hora" value={timeText} onChangeText={setTimeText} testID="setup-time" keyboardType="numbers-and-punctuation" autoCapitalize="none" placeholder="hh:mm" maxLength={5} />
          </View>
        </View>
        <FieldError message={messageFor('scheduledAt')} testID="setup-date-error" />

        <Section label="Partes">
          <ChipRow>
            {PERIODS_COUNT_OPTIONS.map((n) => (
              <Chip key={n} label={String(n)} selected={periodsCount === n} onPress={() => setPeriodsCount(n)} testID={`setup-periods-${n}`} />
            ))}
          </ChipRow>
        </Section>
        <FormField label="Minutos por parte" value={minutesText} onChangeText={setMinutesText} testID="setup-minutes" keyboardType="number-pad" maxLength={2} autoCapitalize="none" />
        <FieldError message={messageFor('periodMinutes')} testID="setup-minutes-error" />

        <Pressable
          onPress={() => setMoreOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: moreOpen }}
          accessibilityLabel="Más (opcional)"
          testID="setup-more-toggle"
          style={styles.moreToggle}
        >
          <Text style={[styles.moreText, { color: colors.accent }]}>{moreOpen ? '▾' : '▸'} Más (opcional)</Text>
        </Pressable>

        {moreOpen ? (
          <View testID="setup-more">
            <Section label="Local / Visitante">
              <ChipRow>
                <Chip label="Local" selected={homeAway === 'HOME'} onPress={() => setHomeAway(homeAway === 'HOME' ? null : 'HOME')} testID="setup-home" />
                <Chip label="Visitante" selected={homeAway === 'AWAY'} onPress={() => setHomeAway(homeAway === 'AWAY' ? null : 'AWAY')} testID="setup-away" />
              </ChipRow>
            </Section>
            <FormField label="Competición" value={competition} onChangeText={setCompetition} testID="setup-competition" maxLength={COMPETITION_MAX_LENGTH + 10} />
            <FieldError message={messageFor('competition')} testID="setup-competition-error" />
            <FormField label="Jornada" value={matchday} onChangeText={setMatchday} testID="setup-matchday" maxLength={MATCHDAY_MAX_LENGTH + 10} />
            <FieldError message={messageFor('matchday')} testID="setup-matchday-error" />
          </View>
        ) : null}

        <BigButton label="CONVOCATORIA  →" onPress={submit} testID="setup-continue" accessibilityLabel="Convocatoria" />
      </ScrollView>
    </SafeAreaView>
  );
}

function FieldError({ message, testID }: { message: string | null; testID: string }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" testID={testID} style={[styles.error, { color: colors.danger }]}>
      {message}
    </Text>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { minWidth: SECONDARY_HEIGHT, minHeight: SECONDARY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, fontWeight: '700' },
  title: { flex: 1, fontSize: 22, fontWeight: '800', paddingHorizontal: 4 },
  step: { fontSize: 15, fontWeight: '700', paddingHorizontal: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  timeBox: { width: 120 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  moreToggle: { minHeight: SECONDARY_HEIGHT, justifyContent: 'center', marginBottom: 6 },
  moreText: { fontSize: 16, fontWeight: '700' },
  error: { marginTop: -8, marginBottom: 12, fontSize: 14, fontWeight: '600' },
});
