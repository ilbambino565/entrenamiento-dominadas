import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SquadService } from '../../app-services/squadService';
import { formationsFor, isValidFormation } from '../../core/formations';
import { GAME_FORMATS, type GameFormatId } from '../../core/formats';
import { displayName } from '../../core/squad';
import type { DisplayNameMode, Player, Team, TeamDraft } from '../../core/team';
import { useTheme } from '../../ui/theme';
import { BigButton, Chip, ChipRow, FormField } from './controls';
import { errorMessage, useSquadScreenState } from './useSquadState';

/**
 * P4 "Equipo" mínima (docs/05 §5.3): lo que la pantalla de nuevo partido
 * propondrá por defecto (formato, dibujo, partes y minutos) y el modo de
 * privacidad de los nombres. Los chips guardan al tocar (una decisión, un
 * toque); los textos al perder el foco o con GUARDAR, para no escribir en la
 * base de datos letra a letra. Al cambiar de formato, el dibujo por defecto
 * se conserva solo si sigue cuadrando; si no, vuelve a "Auto".
 */
export interface TeamScreenProps {
  service: SquadService;
}

const FORMAT_IDS: readonly GameFormatId[] = ['F7', 'F8', 'F11'];
const NAME_MODES: ReadonlyArray<{ mode: DisplayNameMode; label: string }> = [
  { mode: 'full', label: 'Nombre completo' },
  { mode: 'first_initial', label: 'Nombre + inicial' },
  { mode: 'first', label: 'Solo nombre' },
];
const MINUTE_MS = 60_000;
export const PERIOD_MINUTES_MIN = 1;
export const PERIOD_MINUTES_MAX = 90;

export function TeamScreen({ service }: TeamScreenProps) {
  const { colors } = useTheme();
  const state = useSquadScreenState(service);

  if (state.status === 'loading' || state.status === 'error' || state.team === null) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Equipo
        </Text>
        <View style={styles.center}>
          {state.status === 'loading' ? (
            <ActivityIndicator color={colors.accent} testID="team-loading" />
          ) : state.status === 'error' ? (
            <Text style={[styles.message, { color: colors.danger }]} testID="team-error">
              {state.error ?? 'No se pudo cargar el equipo'}
            </Text>
          ) : (
            <Text style={[styles.message, { color: colors.textMuted }]} testID="team-missing">
              Primero crea el equipo
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return <TeamForm key={state.team.id} service={service} team={state.team} players={state.players} />;
}

/** Texto del campo Minutos → ms por parte; null si no es un entero entre 1 y 90. */
export function parsePeriodMinutes(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const minutes = Number(t);
  return minutes >= PERIOD_MINUTES_MIN && minutes <= PERIOD_MINUTES_MAX ? minutes * MINUTE_MS : null;
}

function TeamForm({ service, team, players }: { service: SquadService; team: Team; players: readonly Player[] }) {
  const { colors } = useTheme();
  const [name, setName] = useState(team.name);
  const [category, setCategory] = useState(team.category ?? '');
  const [minutes, setMinutes] = useState(String(Math.round(team.periodDurationMs / MINUTE_MS)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const playersOnField = GAME_FORMATS[team.defaultFormat].playersOnField;
  const formations = formationsFor(playersOnField);

  const update = useCallback(
    (patch: Partial<TeamDraft>) => {
      setError(null);
      setSaving(true);
      service
        .updateTeam(patch)
        .catch((e: unknown) => setError(errorMessage(e, 'No se pudo guardar el equipo')))
        .finally(() => setSaving(false));
    },
    [service],
  );

  /** Los tres campos de texto: solo lo que cambia y solo si es válido. */
  const saveTexts = useCallback(() => {
    const patch: Partial<TeamDraft> = {};
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('El nombre del equipo es obligatorio');
      return;
    }
    if (trimmedName !== team.name) patch.name = trimmedName;
    const trimmedCategory = category.trim();
    const nextCategory = trimmedCategory === '' ? null : trimmedCategory;
    if (nextCategory !== team.category) patch.category = nextCategory;
    const periodDurationMs = parsePeriodMinutes(minutes);
    if (periodDurationMs === null) {
      setError(`Los minutos por parte deben estar entre ${PERIOD_MINUTES_MIN} y ${PERIOD_MINUTES_MAX}`);
      return;
    }
    if (periodDurationMs !== team.periodDurationMs) patch.periodDurationMs = periodDurationMs;
    if (Object.keys(patch).length === 0) {
      setError(null);
      return;
    }
    update(patch);
  }, [name, category, minutes, team, update]);

  // Al cambiar de pestaña la pantalla se desmonta sin `onBlur`: lo escrito se guarda igualmente.
  const latestSave = useRef(saveTexts);
  latestSave.current = saveTexts;
  useEffect(() => () => latestSave.current(), []);

  const sample = players.find((p) => p.isActive) ?? players[0] ?? null;
  const namePreview = displayName(sample ?? { firstName: 'Ana', lastName: 'García' }, team.displayNameMode);

  const chooseFormat = useCallback(
    (defaultFormat: GameFormatId) => {
      if (defaultFormat === team.defaultFormat) return;
      const keep = team.defaultFormation !== null && isValidFormation(team.defaultFormation, GAME_FORMATS[defaultFormat].playersOnField);
      update({ defaultFormat, defaultFormation: keep ? team.defaultFormation : null });
    },
    [team, update],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Equipo
        </Text>

        <FormField label="Nombre" value={name} onChangeText={setName} onBlur={saveTexts} testID="team-name" />
        <FormField label="Categoría" value={category} onChangeText={setCategory} onBlur={saveTexts} testID="team-category" placeholder="Alevín, Benjamín…" />

        <Section label="Formato">
          <ChipRow>
            {FORMAT_IDS.map((id) => (
              <Chip key={id} label={id} selected={team.defaultFormat === id} onPress={() => chooseFormat(id)} testID={`format-${id}`} disabled={saving} />
            ))}
          </ChipRow>
        </Section>

        <Section label="Dibujo por defecto">
          <ChipRow>
            <Chip label="Auto" selected={team.defaultFormation === null} onPress={() => update({ defaultFormation: null })} testID="formation-auto" disabled={saving} />
            {formations.map((f) => (
              <Chip key={f} label={f} selected={team.defaultFormation === f} onPress={() => update({ defaultFormation: f })} testID={`formation-${f}`} disabled={saving} />
            ))}
          </ChipRow>
        </Section>

        <Section label="Duración">
          <View style={styles.durationRow}>
            <View style={[styles.periodsBox, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.periodsLabel, { color: colors.textMuted }]}>Partes</Text>
              <Text style={[styles.periodsValue, { color: colors.text }]} testID="period-count">
                {team.periodsCount}
              </Text>
            </View>
            <Text style={[styles.times, { color: colors.textMuted }]}>×</Text>
            <View style={styles.minutesField}>
              <FormField label="Minutos por parte" value={minutes} onChangeText={setMinutes} onBlur={saveTexts} testID="period-minutes" keyboardType="number-pad" maxLength={2} autoCapitalize="none" />
            </View>
          </View>
        </Section>

        <Section label="Nombres en el partido">
          <ChipRow>
            {NAME_MODES.map(({ mode, label }) => (
              <Chip key={mode} label={label} selected={team.displayNameMode === mode} onPress={() => update({ displayNameMode: mode })} testID={`names-${mode}`} disabled={saving} />
            ))}
          </ChipRow>
          <Text style={[styles.preview, { color: colors.textMuted }]} testID="names-preview">
            En las fichas del partido se verá: {namePreview}
          </Text>
        </Section>

        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]} testID="team-save-error">
            {error}
          </Text>
        ) : null}

        <BigButton label="GUARDAR" onPress={saveTexts} disabled={saving} testID="save-team" />
      </ScrollView>
    </SafeAreaView>
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
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '800', paddingVertical: 12, paddingHorizontal: 16, marginHorizontal: -16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  section: { marginBottom: 18 },
  sectionLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  durationRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  periodsBox: { minHeight: 56, minWidth: 72, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'center', marginBottom: 14 },
  periodsLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  periodsValue: { fontSize: 20, fontWeight: '800' },
  times: { fontSize: 22, fontWeight: '700', marginBottom: 28 },
  minutesField: { flex: 1 },
  error: { marginBottom: 12, fontSize: 15, fontWeight: '600' },
  preview: { marginTop: 8, fontSize: 14 },
});
