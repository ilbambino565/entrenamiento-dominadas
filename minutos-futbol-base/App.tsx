import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Pantalla de bienvenida provisional. El motor del partido y el panel de
 * cámara NO se montan aquí: las pantallas llegan en los hitos M3-M5
 * (docs/06-roadmap.md) y se compondrán con `createMatchSession`.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Minutos Fútbol Base</Text>
      <Text style={styles.note}>Fase de diseño: MVP en construcción</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  note: {
    fontSize: 14,
    color: '#6b7280',
  },
});
