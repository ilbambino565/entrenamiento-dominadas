import { useStore } from 'zustand';
import type { CameraStore, CameraStoreState } from '../../camera';

/**
 * Lectura reactiva del `CameraStore` (zustand vanilla) desde React. El
 * selector limita los repintados a lo que cada componente necesita: la
 * pantalla del partido no debe repintarse porque la cámara cambie de zoom.
 */
export function useCameraState<T>(store: CameraStore, selector: (state: CameraStoreState) => T): T {
  return useStore(store, selector);
}
