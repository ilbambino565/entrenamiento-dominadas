import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BASIC_CAMERA_ZONES,
  type CameraConnectionState,
  type CameraRecordingState,
  type CameraService,
  type CameraStore,
  type CameraZone,
} from '../../camera';
import { FEATURE_FLAGS } from '../../lib/featureFlags';
import { useCameraState } from './useCameraStore';

/**
 * Panel de control de cámara (modo `zones`, futuro). Construido y probado
 * contra el DummyCameraController pero OCULTO tras FEATURE_FLAGS.cameraPanel:
 * en el MVP no ocupa espacio en la pantalla de partido.
 *
 * Todo pasa por el `CameraService` (nunca por el controlador): el servicio no
 * lanza, así que un fallo de la cámara se queda en `status.error` y jamás
 * bloquea la pantalla del partido. Botones grandes (≥ 56 dp) porque se usa de
 * pie, con el móvil en una mano y mirando al campo.
 */
export interface CameraPanelProps {
  store: CameraStore;
  service: CameraService;
  /** Por defecto, el feature flag. Si no es visible no renderiza nada. */
  visible?: boolean;
}

const ZONE_LABELS: Record<CameraZone, string> = {
  FAR_LEFT: 'MUY IZQUIERDA',
  LEFT: 'IZQUIERDA',
  CENTER: 'CENTRO',
  RIGHT: 'DERECHA',
  FAR_RIGHT: 'MUY DERECHA',
};

const CONNECTION_LABELS: Record<CameraConnectionState, string> = {
  disconnected: 'Desconectada',
  connecting: 'Conectando',
  connected: 'Conectada',
  error: 'Error',
};

const CONNECTION_COLORS: Record<CameraConnectionState, string> = {
  disconnected: '#9ca3af',
  connecting: '#fbbf24',
  connected: '#22c55e',
  error: '#ef4444',
};

const RECORDING_LABELS: Record<CameraRecordingState, string> = {
  idle: 'Sin grabar',
  recording: 'Grabando',
  paused: 'Grabación en pausa',
};

interface PanelButtonProps {
  label: string;
  testID: string;
  disabled: boolean;
  active?: boolean;
  onPress: () => void;
}

function PanelButton({ label, testID, disabled, active = false, onPress }: PanelButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function CameraPanel({ store, service, visible = FEATURE_FLAGS.cameraPanel }: CameraPanelProps) {
  // El hook va antes del return condicional: el orden de hooks no puede depender de `visible`.
  const { settings, status, available, capabilities } = useCameraState(store, (state) => state);
  if (!visible) return null;

  const external = settings.mode === 'external';
  // Solo se ofrece lo que el dispositivo sabe hacer: un gimbal no graba y una
  // cámara no se mueve. Mejor un botón apagado que un error al pulsar.
  const canPan = available && capabilities?.pan === true;
  const canRecord = available && capabilities?.record === true;
  const canPause = canRecord && capabilities?.pause === true;
  const canZoom = available && capabilities?.zoom === true;
  const zonesEnabled = canPan && settings.mode === 'zones';
  const idle = status.recording === 'idle';
  const paused = status.recording === 'paused';

  return (
    <View style={styles.panel} testID="camera-panel">
      <View style={styles.indicators}>
        <View style={styles.indicator} testID="camera-connection">
          <View style={[styles.dot, { backgroundColor: external ? '#9ca3af' : CONNECTION_COLORS[status.connection] }]} />
          <Text style={styles.indicatorText}>{external ? 'Control externo' : CONNECTION_LABELS[status.connection]}</Text>
        </View>
        <View style={styles.indicator} testID="camera-recording">
          <View style={[styles.dot, { backgroundColor: status.recording === 'recording' ? '#ef4444' : '#9ca3af' }]} />
          <Text style={styles.indicatorText}>{RECORDING_LABELS[status.recording]}</Text>
        </View>
      </View>
      {status.error !== null && (
        <Text style={styles.error} testID="camera-error">
          {status.error}
        </Text>
      )}

      <View style={styles.row}>
        {BASIC_CAMERA_ZONES.map((zone) => (
          <PanelButton
            key={zone}
            testID={`camera-zone-${zone}`}
            label={ZONE_LABELS[zone]}
            // Una zona sin calibrar no tiene a dónde ir: mejor deshabilitada que un error.
            disabled={!zonesEnabled || settings.zones[zone] === null}
            active={status.zone === zone}
            onPress={() => void service.goToZone(zone)}
          />
        ))}
      </View>

      <View style={styles.row}>
        <PanelButton
          testID="camera-rec"
          label="REC"
          disabled={!canRecord || !idle}
          onPress={() => void service.startRecording()}
        />
        <PanelButton
          testID="camera-pause"
          label={paused ? 'REANUDAR' : 'PAUSA'}
          disabled={!canPause || idle}
          onPress={() => void (paused ? service.resumeRecording() : service.pauseRecording())}
        />
        <PanelButton
          testID="camera-stop"
          label="STOP"
          disabled={!canRecord || idle}
          onPress={() => void service.stopRecording()}
        />
      </View>

      <View style={styles.row}>
        {settings.zoomEnabled && (
          <>
            <PanelButton testID="camera-zoom-out" label="ZOOM −" disabled={!canZoom} onPress={() => void service.zoomOut()} />
            <PanelButton testID="camera-zoom-in" label="ZOOM +" disabled={!canZoom} onPress={() => void service.zoomIn()} />
          </>
        )}
        <PanelButton testID="camera-recenter" label="RECENTER" disabled={!canPan} onPress={() => void service.recenter()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 12,
    gap: 8,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  indicatorText: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#374151',
  },
  buttonActive: {
    backgroundColor: '#2563eb',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonTextActive: {
    color: '#ffffff',
  },
});
