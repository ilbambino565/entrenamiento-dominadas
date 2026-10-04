/** Capa de aplicación: fachada del partido, puente de cámara y composición. */
export {
  createMatchEngine,
  type AppBus,
  type MatchEngine,
  type MatchEngineDeps,
  type MatchStateListener,
} from './matchEngine';
export { createCameraTimelineBridge } from './cameraTimelineBridge';
export { createMatchSession, type MatchSession, type MatchSessionDeps } from './createMatchSession';
export {
  createSquadService,
  SquadError,
  type MatchSetup,
  type SquadErrorCode,
  type SquadService,
  type SquadServiceDeps,
  type SquadState,
} from './squadService';
