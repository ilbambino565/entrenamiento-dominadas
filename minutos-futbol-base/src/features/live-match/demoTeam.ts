/** Equipo de prueba F7 para ver la pantalla sin base de datos ni navegación. */
export interface PlayerInfo {
  id: string;
  name: string;
  number: number;
  isGoalkeeper?: boolean;
}

export const DEMO_PLAYERS: readonly PlayerInfo[] = [
  { id: 'hugo', name: 'Hugo', number: 5 },
  { id: 'lucas', name: 'Lucas', number: 7 },
  { id: 'mateo', name: 'Mateo', number: 8 },
  { id: 'leo', name: 'Leo', number: 6 },
  { id: 'daniel', name: 'Daniel', number: 4 },
  { id: 'pablo', name: 'Pablo', number: 9 },
  { id: 'alex', name: 'Álex', number: 11 },
  { id: 'marco', name: 'Marco', number: 1, isGoalkeeper: true },
  { id: 'adrian', name: 'Adrián', number: 3 },
  { id: 'david', name: 'David', number: 12 },
];

export const DEMO_SQUAD: readonly string[] = DEMO_PLAYERS.map((p) => p.id);

export const DEMO_PLAYER_MAP: Record<string, PlayerInfo> = Object.fromEntries(DEMO_PLAYERS.map((p) => [p.id, p]));
