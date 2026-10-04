import { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import crest from '../../../assets/club/escudo-circular-128.png';
import type { SquadService } from '../../app-services/squadService';
import { GAME_FORMATS } from '../../core/formats';
import type { TeamDraft } from '../../core/team';
import { useTheme } from '../../ui/theme';
import { BigButton, FormField, errorMessage } from '../squad';

/**
 * Primer arranque sin equipo (docs/05 §5.1). El asistente previsto (nombre →
 * formato → jugadores) se reduce a un campo y un botón: el formato es F7 con
 * sus valores por defecto y los jugadores se añaden en la pestaña Plantilla,
 * a la que se salta al crear el equipo. Todo se puede cambiar después en
 * Equipo. Un entrenador con prisa debe estar dando de alta jugadores en diez
 * segundos.
 */
export interface FirstRunScreenProps {
  service: SquadService;
  /** El equipo ya existe: el shell abre la pestaña Plantilla. */
  onCreated: () => void;
}

/** Equipo del primer arranque: F7 con sus valores por defecto y solo el nombre de pila en el partido. */
export function firstTeamDraft(name: string): TeamDraft {
  const f7 = GAME_FORMATS.F7;
  return {
    name,
    category: null,
    federationName: null,
    defaultFormat: 'F7',
    defaultFormation: null,
    periodsCount: f7.defaultPeriodsCount,
    periodDurationMs: f7.defaultPeriodDurationMs,
    displayNameMode: 'first',
  };
}

export function FirstRunScreen({ service, onCreated }: FirstRunScreenProps) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await service.createTeam(firstTeamDraft(name));
      onCreated();
    } catch (cause: unknown) {
      // Si se creó, esta pantalla desaparece; solo se vuelve a habilitar si falló.
      setError(errorMessage(cause, 'No se pudo crear el equipo'));
      setBusy(false);
    }
  }, [busy, name, service, onCreated]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image source={crest} style={styles.crest} accessibilityIgnoresInvertColors />
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" testID="first-run-title">
            Tu equipo
          </Text>
          <Text style={[styles.lead, { color: colors.textMuted }]}>
            Escribe el nombre del equipo para empezar. Los jugadores se añaden después en Plantilla y el formato (fútbol 7, 8 u
            11) se cambia en Equipo.
          </Text>
          <FormField label="Nombre del equipo" value={name} onChangeText={setName} placeholder="CD Ejemplo" testID="first-run-name" />
          {error ? (
            <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert" testID="first-run-error">
              {error}
            </Text>
          ) : null}
          <View style={styles.button}>
            <BigButton label="EMPEZAR" onPress={() => void start()} disabled={busy} testID="first-run-start" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  crest: { width: 72, height: 72, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  lead: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  error: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  button: { marginTop: 8 },
});
