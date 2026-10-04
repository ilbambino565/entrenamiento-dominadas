import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createSquadService, type SquadService } from './src/app-services';
import { AppShell, BootScreen, openPersistence, type Persistence } from './src/features/shell';

/**
 * Raíz de composición de la app: abre la persistencia UNA vez, construye el
 * servicio de equipo y plantilla y monta el AppShell (navegación provisional
 * por pestañas, docs/05 §5.1). En nativo plantilla, partidos y timeline viven
 * en SQLite; en web, la plantilla en memoria con copia en localStorage si
 * existe y lo demás solo en memoria: lo decide
 * `features/shell/openPersistence(.web).ts` por extensión de plataforma,
 * de modo que `expo-sqlite` solo se carga (y la base solo se abre) en nativo.
 * El partido en vivo sigue en memoria (ver features/shell/startMatch.ts).
 * `createDemoSession` queda para tests y demos; ya no se monta aquí.
 */

// Un solo repositorio y un solo servicio por proceso aunque el componente se
// vuelva a montar (recarga en caliente): la promesa se comparte y solo se
// olvida si falló, para que REINTENTAR vuelva a abrir de verdad.
interface Opened {
  service: SquadService;
  persistence: Persistence;
}

let openedPromise: Promise<Opened> | null = null;

function openApp(): Promise<Opened> {
  if (!openedPromise) {
    openedPromise = openPersistence()
      .then((persistence) => ({ persistence, service: createSquadService({ repo: persistence.squad }) }))
      .catch((error: unknown) => {
        openedPromise = null;
        throw error;
      });
  }
  return openedPromise;
}

type Boot = { status: 'opening' } | ({ status: 'ready' } & Opened) | { status: 'error'; message: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    openApp().then(
      (opened) => {
        if (alive) setBoot({ status: 'ready', ...opened });
      },
      (error: unknown) => {
        console.error('[App] no se pudo abrir la base de datos', error);
        if (alive) setBoot({ status: 'error', message: `No se pudo abrir la base de datos: ${error instanceof Error ? error.message : String(error)}` });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setBoot({ status: 'opening' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {boot.status === 'ready' ? (
          <AppShell service={boot.service} />
        ) : (
          <BootScreen error={boot.status === 'error' ? boot.message : null} onRetry={retry} />
        )}
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
