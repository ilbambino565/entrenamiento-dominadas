import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { SquadService } from '../../app-services/squadService';
import type { LineupEntry } from '../../core';
import type { MatchSetupDraft } from '../../core/matchSetup';
import { teamMatchConfig } from '../../core/squad';
import { readTeamPack } from '../../core/teamPack';
import { useSquadState } from '../../state';
import { useTheme } from '../../ui/theme';
import type { Match } from '../../core/match';
import { LiveMatchScreen, SummarySheet } from '../live-match';
import { ConvocationScreen, LineupScreen, MatchSetupScreen } from '../match-setup';
import { PlayerFormScreen, SquadScreen, TeamScreen } from '../squad';
import type { PlayerFormResult } from '../squad/PlayerFormScreen';
import { BootScreen } from './BootScreen';
import { FirstRunScreen } from './FirstRunScreen';
import { MatchesHome } from './MatchesHome';
import type { Persistence } from './persistence';
import { ResumeMatchScreen } from './ResumeMatchScreen';
import { findResumable, resumeMatch, type ResumableMatch } from './resumeMatch';
import { endMatch, startMatch, type ActiveMatch } from './startMatch';
import { viewMatch, type ViewedMatch } from './viewMatch';
import { TabBar, type Tab } from './TabBar';

/**
 * Navegación provisional de la app (docs/05 §5.1, nota): un shell con estado
 * en React, sin Expo Router todavía. Tres pestañas abajo (Partidos, Plantilla,
 * Equipo) y rutas "modales" a pantalla completa sin pestañas: la ficha de
 * jugador, el asistente de nuevo partido (P5 datos → P6 convocatoria → P7
 * alineación) y el partido en vivo. Expo Router llegará cuando haya varios
 * partidos y enlaces profundos; las pantallas ya reciben todo por props y no
 * cambiarán.
 *
 * Arranque: carga el equipo; si no hay y existe un paquete de equipo
 * (`globalThis.__TEAM_PACK__`, core/teamPack.ts) lo importa como siembra; si
 * sigue sin haber equipo, el primer arranque pide el nombre. JUGAR PARTIDO
 * abre el asistente; INICIAR PARTIDO (P7) crea la fila del partido y su
 * convocatoria, abre la sesión sobre la timeline persistente y la libera al
 * salir. Al arrancar, si quedó un partido en juego (P0), ofrece continuarlo.
 */
export interface AppShellProps {
  service: SquadService;
  /** Partidos y timeline (la plantilla llega ya dentro de `service`). */
  persistence: Persistence;
  /** Reloj del partido (inyectable en tests); por defecto `Date.now`. */
  now?: () => number;
}

type NewMatchStep =
  | { step: 'data' }
  | { step: 'squad'; draft: MatchSetupDraft }
  | { step: 'lineup'; draft: MatchSetupDraft; convocated: string[] };

type Route =
  | { kind: 'tabs' }
  | { kind: 'player'; playerId: string | null }
  | ({ kind: 'new' } & NewMatchStep)
  | { kind: 'match'; match: ActiveMatch }
  | { kind: 'summary'; viewed: ViewedMatch };

const TABS_ROUTE: Route = { kind: 'tabs' };
const RECENT_MATCHES = 20;

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

export function AppShell({ service, persistence, now = Date.now }: AppShellProps) {
  const { colors } = useTheme();
  const state = useSquadState(service);
  const [booted, setBooted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('matches');
  const [route, setRoute] = useState<Route>(TABS_ROUTE);
  const [scrollToEndKey, setScrollToEndKey] = useState(0);
  // P0: `undefined` = aún sin comprobar; `null` = nada que recuperar.
  const [resumable, setResumable] = useState<ResumableMatch | null | undefined>(undefined);
  const [recent, setRecent] = useState<Match[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const closeSummary = useCallback((viewed: ViewedMatch) => {
    viewed.session.dispose().catch((error: unknown) => console.warn('[AppShell] no se pudo liberar la sesión', error));
    setRoute(TABS_ROUTE);
  }, []);

  // Botón/gesto atrás de Android: cierra la ficha, vuelve a Partidos y nunca
  // saca de un partido (se sale con SALIR, mantener pulsado). En iOS y web no hace nada.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.kind === 'player') {
        setRoute(TABS_ROUTE);
        return true;
      }
      if (route.kind === 'match') return true;
      if (route.kind === 'summary') {
        closeSummary(route.viewed);
        return true;
      }
      if (route.kind === 'new') {
        setStartError(null);
        setRoute(route.step === 'lineup' ? { kind: 'new', step: 'squad', draft: route.draft } : route.step === 'squad' ? { kind: 'new', step: 'data' } : TABS_ROUTE);
        return true;
      }
      if (tab !== 'matches') {
        setTab('matches');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [route, tab, closeSummary]);

  useEffect(() => {
    let alive = true;
    void bootSquad(service).finally(() => {
      if (alive) setBooted(true);
    });
    return () => {
      alive = false;
    };
  }, [service, attempt]);

  // Con el equipo cargado se busca, una sola vez por arranque, un partido en juego que recuperar.
  const hasTeam = state.team !== null;
  useEffect(() => {
    if (!booted || !hasTeam || resumable !== undefined) return;
    let alive = true;
    findResumable(persistence, now())
      .catch((error: unknown) => {
        console.warn('[AppShell] no se pudo comprobar si hay un partido en curso', error);
        return null;
      })
      .then((found) => {
        if (alive) setResumable(found);
      });
    return () => {
      alive = false;
    };
  }, [booted, hasTeam, resumable, persistence, now]);

  // La lista de recientes se vuelve a leer cada vez que se vuelve a las pestañas (un partido nuevo, uno terminado…).
  const onTabs = route.kind === 'tabs';
  useEffect(() => {
    if (!booted || !hasTeam || !onTabs) return;
    let alive = true;
    persistence.matches
      .listRecentMatches(RECENT_MATCHES)
      .then((list) => alive && setRecent(list))
      .catch((error: unknown) => console.warn('[AppShell] no se pudo leer la lista de partidos', error));
    return () => {
      alive = false;
    };
  }, [booted, hasTeam, onTabs, persistence, resumable]);

  const openMatch = useCallback(
    async (match: Match) => {
      const team = service.getState().team;
      if (!team) return;
      const players = service.getState().players;
      try {
        if (match.status === 'FINISHED') {
          setRoute({ kind: 'summary', viewed: await viewMatch({ persistence, team, players, match, now }) });
        } else {
          const found = await findResumable(persistence, now(), match);
          if (found) setRoute({ kind: 'match', match: resumeMatch({ persistence, team, players, resumable: found, now }) });
        }
      } catch (error) {
        console.warn('[AppShell] no se pudo abrir el partido', error);
      }
    },
    [service, persistence, now],
  );

  const continueResumed = useCallback(
    (found: ResumableMatch) => {
      const team = service.getState().team;
      if (!team) return;
      setResumable(null);
      setRoute({ kind: 'match', match: resumeMatch({ persistence, team, players: service.getState().players, resumable: found, now }) });
    },
    [service, persistence, now],
  );

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
    setStartError(null);
    setRoute({ kind: 'new', step: 'data' });
  }, []);

  const begin = useCallback(
    async (draft: MatchSetupDraft, convocated: string[], lineup: LineupEntry[], bench: string[]) => {
      const team = service.getState().team;
      if (!team || starting) return;
      setStarting(true);
      setStartError(null);
      try {
        const match = await startMatch({ persistence, team, draft, players: service.getState().players, convocated, lineup, bench, now });
        setRoute({ kind: 'match', match });
      } catch (error) {
        console.warn('[AppShell] no se pudo crear el partido', error);
        setStartError('No se pudo guardar el partido. Inténtalo de nuevo.');
      } finally {
        setStarting(false);
      }
    },
    [service, persistence, now, starting],
  );

  const leaveMatch = useCallback((match: ActiveMatch) => {
    void endMatch(match);
    setRoute(TABS_ROUTE);
    setTab('matches');
  }, []);

  if (!booted) return <BootScreen error={null} onRetry={retry} />;
  if (state.status === 'error') return <BootScreen error={state.error ?? 'No se pudo cargar el equipo y la plantilla'} onRetry={retry} />;
  if (state.team === null) return <FirstRunScreen service={service} onCreated={openSquadTab} />;
  if (resumable === undefined) return <BootScreen error={null} onRetry={retry} />;
  if (resumable !== null && route.kind === 'tabs') {
    return (
      <ResumeMatchScreen
        rival={resumable.match.opponent}
        currentPeriod={resumable.state.currentPeriod}
        status={resumable.state.status}
        clockMs={resumable.clockMs}
        onContinue={() => continueResumed(resumable)}
      />
    );
  }

  if (route.kind === 'new') {
    const { team, players } = state;
    if (route.step === 'data') {
      return <MatchSetupScreen team={team} now={now()} onCancel={() => setRoute(TABS_ROUTE)} onContinue={(draft) => setRoute({ kind: 'new', step: 'squad', draft })} />;
    }
    const { playersOnField } = teamMatchConfig(team);
    if (route.step === 'squad') {
      return (
        <ConvocationScreen
          players={players}
          displayNameMode={team.displayNameMode}
          playersOnField={playersOnField}
          onBack={() => setRoute({ kind: 'new', step: 'data' })}
          onContinue={(convocated) => setRoute({ kind: 'new', step: 'lineup', draft: route.draft, convocated })}
        />
      );
    }
    return (
      <LineupScreen
        team={team}
        players={players}
        convocated={route.convocated}
        playersOnField={playersOnField}
        error={startError}
        busy={starting}
        onBack={() => {
          setStartError(null);
          setRoute({ kind: 'new', step: 'squad', draft: route.draft });
        }}
        onStart={(lineup, bench) => void begin(route.draft, route.convocated, lineup, bench)}
      />
    );
  }
  if (route.kind === 'summary') {
    const { viewed } = route;
    return (
      <SummarySheet
        visible
        onClose={() => closeSummary(viewed)}
        engine={viewed.session.engine}
        state={viewed.state}
        players={viewed.players}
        rival={viewed.match.opponent}
        now={now()}
      />
    );
  }
  if (route.kind === 'match') {
    const { match } = route;
    return (
      <LiveMatchScreen
        session={match.session}
        players={match.players}
        teamName={match.teamName}
        rival={match.rival}
        lineup={match.lineup}
        bench={match.bench}
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
        {tab === 'matches' ? <MatchesHome service={service} onPlay={play} recent={recent} onOpenMatch={(m) => void openMatch(m)} /> : null}
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
