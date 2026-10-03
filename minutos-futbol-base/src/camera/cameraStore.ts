import { createStore } from 'zustand/vanilla';
import { isCameraControlAvailable, normalizeCameraSettings } from './settings';
import { INITIAL_CAMERA_STATUS, cloneCameraStatus } from './status';
import type { CameraCapabilities, CameraSettings, CameraStatus } from './types';

/**
 * CameraState: estado observable de la cámara.
 *
 * Store vanilla de zustand (sin React) para que el servicio lo use desde la
 * capa de aplicación y los tests; la UI lo consumirá con `useStore(store, sel)`.
 * El único escritor es `CameraService`; la UI solo lee. Las acciones van en el
 * objeto store, no dentro del estado, para que el estado sea solo datos.
 */
export interface CameraStoreState {
  settings: CameraSettings;
  status: CameraStatus;
  controllerAttached: boolean;
  /** Capacidades del controlador adjunto; null sin controlador. */
  capabilities: CameraCapabilities | null;
  /** Derivado: la app puede mandar órdenes (modo ≠ external, habilitada y con controlador). */
  available: boolean;
}

export interface CameraStoreActions {
  /** Mezcla y normaliza: lo que no se entienda vuelve al valor por defecto. */
  setSettings(partial: Partial<CameraSettings>): void;
  setStatus(status: CameraStatus): void;
  setControllerAttached(attached: boolean, capabilities?: CameraCapabilities | null): void;
  /** Estado inicial con la configuración con la que se creó el store. */
  reset(): void;
}

export function createCameraStore(initial?: Partial<CameraSettings>) {
  const initialSettings = normalizeCameraSettings(initial);

  const baseState = (settings: CameraSettings): CameraStoreState => ({
    settings,
    status: cloneCameraStatus(INITIAL_CAMERA_STATUS),
    controllerAttached: false,
    capabilities: null,
    available: false,
  });

  const api = createStore<CameraStoreState>()(() => baseState(initialSettings));

  const actions: CameraStoreActions = {
    setSettings: (partial) =>
      api.setState((state) => {
        const settings = normalizeCameraSettings({ ...state.settings, ...partial });
        return { settings, available: isCameraControlAvailable(settings) && state.controllerAttached };
      }),

    setStatus: (status) => api.setState({ status: cloneCameraStatus(status) }),

    setControllerAttached: (attached, capabilities = null) =>
      api.setState((state) => ({
        controllerAttached: attached,
        capabilities: attached ? capabilities && { ...capabilities } : null,
        available: isCameraControlAvailable(state.settings) && attached,
      })),

    reset: () => api.setState(baseState(initialSettings)),
  };

  return { ...api, ...actions };
}

export type CameraStore = ReturnType<typeof createCameraStore>;
