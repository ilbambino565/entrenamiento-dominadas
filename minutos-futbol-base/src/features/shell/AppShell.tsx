import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { SquadService } from '../../app-services/squadService';
import { readTeamPack } from '../../core/teamPack';
import { useSquadState } from '../../state';
import { useTheme } from '../../ui/theme';
import { LiveMatchScreen } from '../live-match';
import { PlayerFormScreen, SquadScreen, TeamScreen } from '../squad';
import type { PlayerFormResult } from '../squad/PlayerFormScreen';
import { BootScreen } from './BootScreen';
import { FirstRunScreen } from './FirstRunScreen';
import { MatchesHome } from './MatchesHome';
import { startMatch, type ActiveMatch } from './startMatch';
import { TabBar, type Tab } from './TabBar';

/**
 * Navegación provisional de la app (docs/05 §5.1, nota): un shell con estado
 * en React, sin Expo Router todavía. Tres pestañas abajo (Partidos, Plantilla,
 * Equipo) y dos rutas "modales" a pantalla completa sin pestañas: la ficha de
 * jugador y el partido en vivo. Expo Router llegará cuando haya varios
 * partidos y enlaces profundos; las pantallas ya reciben todo por props y no
 * cambiarán.
 *
 * Arranque: carga el equipo; si no hay y existe un paquete de equipo
 * (`globalThis.__TEAM_PACK__`, core/teamPack.ts) lo importa como siembra; si
 * sigue sin haber equipo, el primer arranque pide el nombre. La sesión de
 * partido se crea una vez al pulsar JUGAR PARTIDO y se libera al salir.
 */
export interface AppShellProps {
  service: SquadService;
  /** Reloj del partido (inyectable en tests); por defecto `Date.now`. */
  now?: () => number;
}

type Route = { kind: 'tabs' } | { kind: 'player'; playerId: string | null } | { kind: 'match'; match: ActiveMatch };

const TABS_ROUTE: Route = { kind: 'tabs' };

/**
 * Carga y siembra del primer arranque. Nunca rechaza: un fallo de carga deja
 * el servicio en `status: 'error'` (el shell lo muestra con REINTENTAR) y un
 * fallo al importar el paquete solo se registra: el entrenador puede crear
 * el equipo a mano igualmente.
 */
export async function bootSquad(service: SquadService): Promise<void> {
  let seeded: boolean;
  try {
    const loaded = await service.load();
    // Equipo sin jugadores (p. ej. una siembra que falló a medias) también se siembra.
    seeded = loaded.team !== null && loaded.players.length > 0;
  } catch (error) {
    console.warn('[AppShell] no se pudo cargar el equipo', error);
    return;
  }
  if (seeded) return;
  const pack = readTeamPack();
  if (!pack) return;
  try {
    await service.importTeamPack(pack);
  } catch (error) {
    console.warn('[AppShell] no se pudo importar el paquete de equipo', error);
  }
}

export function AppShell({ service, now = Date.now }: AppShellProps) {
  const { colors } = useTheme();
  const state = useSquadState(service);
  const [booted, setBooted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('matches');
  const [route, setRoute] = useState<Route>(TABS_ROUTE);
  const [scrollToEndKey, setScrollToEndKey] = useState(0);

  // Botón/gesto atrás de Android: cierra la ficha, vuelve a Partidos y nunca
  // saca de un partido (se sale con SALIR, mantener pulsado). En iOS y web no hace nada.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.kind === 'player') {
        setRoute(TABS_ROUTE);
        return true;
      }
      if (route.kind === 'match') return true;
      if (tab !== 'matches') {
        setTab('matches');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [route, tab]);

  useEffect(() => {
    let alive = true;
    void bootSquad(service).finally(() => {
      if (alive) setBooted(true);
    });
    return () => {
      alive = false;
    };
  }, [service, attempt]);

  const retry = useCallback(() => {
    setBooted(false);
    setAttempt((n) => n + 1);
  }, []);
  const openSquadTab = useCallback(() => setTab('squad'), []);
  const addPlayer = useCallback(() => setRoute({ kind: 'player', playerId: null }), []);
  const editPlayer = useCallback((id: string) => setRoute({ kind: 'player', playerId: id }), []);
  const closeForm = useCallback((result: PlayerFormResult, created: boolean) => {
    if (result === 'saved' && created) setScrollToEndKey((k) => k + 1);
    setRoute(TABS_ROUTE);
  }, []);

  const play = useCallback(() => {
    try {
      setRoute({ kind: 'match', match: startMatch(service.matchSetup(), now) });
    } catch (error) {
      console.warn('[AppShell] no se pudo preparar el partido', error);
    }
  }, [service, now]);

  const leaveMatch = useCallback((match: ActiveMatch) => {
    match.session.dispose().catch((error: unknown) => console.warn('[AppShell] no se pudo liberar la sesión', error));
    setRoute(TABS_ROUTE);
    setTab('matches');
  }, []);

  if (!booted) return <BootScreen error={null} onRetry={retry} />;
  if (state.status === 'error') return <BootScreen error={state.error ?? 'No se pudo cargar el equipo y la plantilla'} onRetry={retry} />;
  if (state.team === null) return <FirstRunScreen service={service} onCreated={openSquadTab} />;

  if (route.kind === 'match') {
    const { match } = route;
    return (
      <LiveMatchScreen
        session={match.session}
        players={match.setup.players}
        teamName={match.setup.teamName}
        rival=""
        lineup={match.setup.lineup}
        bench={match.setup.bench}
        onExit={() => leaveMatch(match)}
      />
    );
  }
  if (route.kind === 'player') {
    const created = route.playerId === null;
    return <PlayerFormScreen service={service} playerId={route.playerId} onDone={(result) => closeForm(result, created)} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {tab === 'matches' ? <MatchesHome service={service} onPlay={play} /> : null}
        {tab === 'squad' ? <SquadScreen service={service} onAddPlayer={addPlayer} onEditPlayer={editPlayer} scrollToEndKey={scrollToEndKey} /> : null}
        {tab === 'team' ? <TeamScreen service={service} /> : null}
      </View>
      <TabBar current={tab} onSelect={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
