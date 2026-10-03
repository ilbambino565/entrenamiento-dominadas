import { createStore } from 'zustand/vanilla';
import { isCameraControlAvailable, normalizeCameraSettings } from './settings';
import { INITIAL_CAMERA_STATUS, cloneCameraStatus } from './status';
import type { CameraSettings, CameraStatus } from './types';

export { INITIAL_CAMERA_STATUS } from './status';

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
  /** Derivado: la app puede mandar órdenes (modo ≠ external, habilitada y con controlador). */
  available: boolean;
}

export interface CameraStoreActions {
  /** Mezcla y normaliza: lo que no se entienda vuelve al valor por defecto. */
  setSettings(partial: Partial<CameraSettings>): void;
  setStatus(status: CameraStatus): void;
  setControllerAttached(attached: boolean): void;
  /** Estado inicial con la configuración con la que se creó el store. */
  reset(): void;
}

export function createCameraStore(initial?: Partial<CameraSettings>) {
  const initialSettings = normalizeCameraSettings(initial);

  const baseState = (settings: CameraSettings): CameraStoreState => ({
    settings,
    status: cloneCameraStatus(INITIAL_CAMERA_STATUS),
    controllerAttached: false,
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

    setControllerAttached: (attached) =>
      api.setState((state) => ({
        controllerAttached: attached,
        available: isCameraControlAvailable(state.settings) && attached,
      })),

    reset: () => api.setState(baseState(initialSettings)),
  };

  return { ...api, ...actions };
}

export type CameraStore = ReturnType<typeof createCameraStore>;
