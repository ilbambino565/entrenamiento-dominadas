/** Navegación provisional por pestañas, primer arranque e inicio de partido con la plantilla real (docs/05 §5.1, nota). */
export { AppShell, bootSquad, type AppShellProps } from './AppShell';
export { BootScreen, type BootScreenProps } from './BootScreen';
export { FirstRunScreen, firstTeamDraft, type FirstRunScreenProps } from './FirstRunScreen';
export { MatchesHome, PLAY_BUTTON_HEIGHT, plannedFormation, type MatchesHomeProps } from './MatchesHome';
export { startMatch, endMatch, type ActiveMatch, type StartMatchInput } from './startMatch';
export { trackMatchProgress, progressOf, type MatchProgressTracker } from './trackMatchProgress';
export { TabBar, TABS, TAB_HEIGHT, type Tab, type TabBarProps, type TabItem } from './TabBar';
export { openPersistence } from './openPersistence';
export type { Persistence } from './persistence';
