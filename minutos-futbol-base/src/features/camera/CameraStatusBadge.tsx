import { StyleSheet, Text, View } from 'react-native';
import type { CameraStore, CameraStoreState } from '../../camera';
import { FEATURE_FLAGS } from '../../lib/featureFlags';
import { useCameraState } from './useCameraStore';

/**
 * Distintivo pequeño `CAMERA ● EXTERNAL` para la pantalla de partido. Oculto
 * por defecto (FEATURE_FLAGS.cameraStatusBadge): en el MVP solo informa de que
 * la cámara se maneja desde fuera.
 */
export interface CameraStatusBadgeProps {
  store: CameraStore;
  /** Por defecto, el feature flag. Si no es visible no renderiza nada. */
  visible?: boolean;
}

export type CameraBadgeLabel = 'EXTERNAL' | 'OFF' | 'REC' | 'PAUSED' | 'ON';

/** El modo manda sobre todo lo demás: en `external` la app no controla nada, grabe o no. */
export function selectBadgeLabel({ settings, status }: CameraStoreState): CameraBadgeLabel {
  if (settings.mode === 'external') return 'EXTERNAL';
  if (!settings.enabled) return 'OFF';
  if (status.recording === 'recording') return 'REC';
  if (status.recording === 'paused') return 'PAUSED';
  return 'ON';
}

export function CameraStatusBadge({ store, visible = FEATURE_FLAGS.cameraStatusBadge }: CameraStatusBadgeProps) {
  // El hook va antes del return condicional: el orden de hooks no puede depender de `visible`.
  const label = useCameraState(store, selectBadgeLabel);
  if (!visible) return null;
  return (
    <View style={styles.badge} testID="camera-status-badge">
      <Text style={[styles.text, label === 'REC' && styles.textRecording]}>CAMERA ● {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#1f2937',
  },
  text: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  textRecording: {
    color: '#f87171',
  },
});
