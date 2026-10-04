import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../ui/theme';
import { BigButton } from '../squad';

/**
 * Pantalla de arranque: un indicador mientras se abre la base de datos o se
 * carga la plantilla y, si algo falla, el error con REINTENTAR. La usan la
 * raíz (App.tsx, al abrir SQLite) y el AppShell (al cargar el equipo), así
 * las dos esperas se ven iguales y hay un solo sitio que decidir cómo se
 * cuenta un fallo de arranque.
 */
export interface BootScreenProps {
  /** Texto del fallo; `null` mientras se espera. */
  error: string | null;
  onRetry: () => void;
}

export function BootScreen({ error, onRetry }: BootScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {error === null ? (
        <ActivityIndicator color={colors.accent} testID="boot-loading" />
      ) : (
        <>
          <Text style={[styles.message, { color: colors.danger }]} accessibilityRole="alert" testID="boot-error">
            {error}
          </Text>
          <View style={styles.button}>
            <BigButton label="REINTENTAR" onPress={onRetry} testID="boot-retry" />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 20 },
});
