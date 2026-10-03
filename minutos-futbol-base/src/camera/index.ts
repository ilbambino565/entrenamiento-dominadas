/** Superficie pública del módulo de cámara. */
export * from './types';
export { clampZoom, isCameraControlAvailable, normalizeCameraSettings } from './settings';
export { INITIAL_CAMERA_STATUS, cloneCameraStatus } from './status';
export {
  createDummyCameraController,
  type DummyCameraController,
  type DummyCameraControllerOptions,
} from './dummyCameraController';
export {
  createCameraStore,
  type CameraStore,
  type CameraStoreActions,
  type CameraStoreState,
} from './cameraStore';
export { createCameraService, type CameraService, type CameraServiceDeps } from './cameraService';
export { createCameraAutomation, type ClockBusEventMap } from './automation';
