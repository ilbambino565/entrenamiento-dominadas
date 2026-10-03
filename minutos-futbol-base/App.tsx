import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LiveMatchScreen, createDemoSession } from './src/features/live-match';

/**
 * Montaje provisional de la pantalla de partido con un equipo de prueba en
 * memoria. La navegación (Expo Router) y SQLite llegan en hitos posteriores.
 */
export default function App() {
  // Una sola sesión por montaje: el estado inicial perezoso no se vuelve a crear.
  const [demo] = useState(() => createDemoSession());
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <LiveMatchScreen session={demo.session} players={demo.players} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
