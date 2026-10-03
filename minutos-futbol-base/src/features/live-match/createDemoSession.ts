import { createMatchSession, type MatchSession } from '../../app-services/createMatchSession';
import type { LineupEntry, MatchConfig } from '../../core';
import { createInMemoryEventStore } from '../../db/inMemoryEventStore';
import { DEMO_PLAYER_MAP, DEMO_SQUAD, type PlayerInfo } from './demoTeam';

const MINUTE = 60_000;

export const DEMO_CONFIG: MatchConfig = {
  matchId: 'demo',
  playersOnField: 7,
  periodsCount: 2,
  periodDurationMs: 25 * MINUTE,
  squad: DEMO_SQUAD,
};

/** 2-3-1 con el portero abajo (y crece hacia la portería propia). */
export const DEMO_LINEUP: readonly LineupEntry[] = [
  { playerId: 'marco', position: { x: 0.5, y: 0.9 }, goalkeeper: true },
  { playerId: 'daniel', position: { x: 0.3, y: 0.68 } },
  { playerId: 'leo', position: { x: 0.7, y: 0.68 } },
  { playerId: 'lucas', position: { x: 0.2, y: 0.45 } },
  { playerId: 'mateo', position: { x: 0.5, y: 0.45 } },
  { playerId: 'alex', position: { x: 0.8, y: 0.45 } },
  { playerId: 'pablo', position: { x: 0.5, y: 0.22 } },
];

export const DEMO_BENCH: readonly string[] = DEMO_SQUAD.filter((id) => !DEMO_LINEUP.some((e) => e.playerId === id));

export interface DemoSession {
  session: MatchSession;
  players: Record<string, PlayerInfo>;
}

/** Sesión en memoria (sin SQLite) con la cámara desactivada. */
export function createDemoSession(options: { now?: () => number } = {}): DemoSession {
  const session = createMatchSession({
    config: DEMO_CONFIG,
    store: createInMemoryEventStore(),
    cameraSettings: null,
    now: options.now,
  });
  return { session, players: DEMO_PLAYER_MAP };
}

/** Carga el partido y deja la alineación puesta: la pantalla arranca en READY. */
export async function prepareDemo(session: MatchSession, at?: number): Promise<void> {
  const state = await session.engine.load();
  // Si ya se preparó (p. ej. remontaje en desarrollo) no se repite la alineación.
  if (state.status !== 'DRAFT') return;
  await session.engine.setLineup([...DEMO_LINEUP], [...DEMO_BENCH], at);
}
