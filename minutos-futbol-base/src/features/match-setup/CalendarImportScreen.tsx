import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../ui/theme';
import { BigButton, SECONDARY_HEIGHT } from '../squad/controls';
import { ImportCalendarError, type ImportedCalendar } from '../shell/importCalendar';

/**
 * "Importar calendario": el entrenador pega el texto que copia de la web de la
 * RFAF (no se lee nada de la web desde la app) y se guardan sus partidos. Sin
 * nombre en la federación no se puede buscar al equipo: se explica y se ofrece
 * ir a Equipo. Un texto sin partidos del equipo no borra lo guardado.
 */
export interface CalendarImportScreenProps {
  /** Nombre del equipo en la federación; null si aún no se ha indicado. */
  federationName: string | null;
  onImport: (text: string) => Promise<ImportedCalendar>;
  onBack: () => void;
  onGoToTeam: () => void;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; result: ImportedCalendar };

const ERROR_TEXT = {
  NO_FEDERATION_NAME: 'Primero indica el nombre de tu equipo en la federación (pestaña Equipo).',
  NO_MATCHES: 'No he encontrado partidos de tu equipo en ese texto. Comprueba que has copiado el calendario completo y que el nombre en la federación está escrito como en la web.',
} as const;

export function CalendarImportScreen({ federationName, onImport, onBack, onGoToTeam }: CalendarImportScreenProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submit = async () => {
    if (status.kind === 'busy') return;
    setStatus({ kind: 'busy' });
    try {
      setStatus({ kind: 'done', result: await onImport(text) });
    } catch (error) {
      const message = error instanceof ImportCalendarError ? ERROR_TEXT[error.code] : 'No se pudo guardar el calendario. Inténtalo de nuevo.';
      setStatus({ kind: 'error', message });
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver" testID="calendar-back" style={styles.back}>
          <Text style={[styles.backText, { color: colors.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Importar calendario
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {federationName === null ? (
          <View testID="calendar-no-name">
            <Text style={[styles.body, { color: colors.text }]}>
              Para encontrar tus partidos necesito saber cómo se llama tu equipo en la federación.
            </Text>
            <View style={styles.gap}>
              <BigButton label="IR A EQUIPO" onPress={onGoToTeam} testID="calendar-go-team" />
            </View>
          </View>
        ) : status.kind === 'done' ? (
          <View testID="calendar-done">
            <Text style={[styles.doneTitle, { color: colors.text }]} testID="calendar-done-count">
              {status.result.count} {status.result.count === 1 ? 'partido guardado' : 'partidos guardados'}
            </Text>
            {status.result.competition ? (
              <Text style={[styles.body, { color: colors.textMuted }]} testID="calendar-done-competition">
                {status.result.competition}
                {status.result.season ? ` · ${status.result.season}` : ''}
              </Text>
            ) : null}
            <Text style={[styles.body, { color: colors.textMuted }]}>Los verás en Próximos partidos. Para actualizarlo, vuelve a pegar el calendario: lo ya jugado se conserva.</Text>
            <View style={styles.gap}>
              <BigButton label="LISTO" onPress={onBack} testID="calendar-finish" />
            </View>
          </View>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.textMuted }]} testID="calendar-help">
              En la web de la RFAF abre el calendario de tu grupo, pulsa «Versión resumida», selecciona todo, copia y pega aquí. Buscaré los partidos de{' '}
              <Text style={{ color: colors.text, fontWeight: '700' }}>{federationName}</Text>.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Pega aquí el calendario"
              placeholderTextColor={colors.neutralRing}
              accessibilityLabel="Calendario copiado de la RFAF"
              testID="calendar-input"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.neutralRing }]}
            />
            {status.kind === 'error' ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]} testID="calendar-error">
                {status.message}
              </Text>
            ) : null}
            <BigButton label="IMPORTAR" onPress={() => void submit()} testID="calendar-import" disabled={status.kind === 'busy' || text.trim() === ''} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  back: { minWidth: SECONDARY_HEIGHT, minHeight: SECONDARY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, fontWeight: '700' },
  title: { flex: 1, fontSize: 22, fontWeight: '800', paddingHorizontal: 4 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  body: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
  doneTitle: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  gap: { marginTop: 16 },
  input: { minHeight: 180, maxHeight: 320, borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, marginBottom: 12 },
  error: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
});
