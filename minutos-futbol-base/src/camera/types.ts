/**
 * MÓDULO DE CÁMARA: contratos.
 *
 * Este módulo es independiente del partido, de los jugadores y del cronómetro.
 * No importa nada de `src/core`, `src/db` ni `src/app-services`. Se comunica
 * con el resto de la app exclusivamente a través del EventBus.
 *
 * En el MVP solo existe `DummyCameraController`. DJI, Sony o red llegarán como
 * nuevas implementaciones de `CameraController` sin tocar nada más.
 */

export type CameraMode = 'external' | 'zones' | 'auto';

export const CAMERA_MODES: readonly CameraMode[] = ['external', 'zones', 'auto'];

/** Lista en tiempo de ejecución (para normalizar JSON) y tipo derivado de ella. */
export const CAMERA_DEVICE_TYPES = ['dummy', 'dji_rsc2', 'sony_a6600', 'network'] as const;
export type CameraDeviceType = (typeof CAMERA_DEVICE_TYPES)[number];

/**
 * Lo que el dispositivo sabe hacer. Un gimbal (DJI RSC 2) mueve pero no graba;
 * una cámara (Sony A6600) graba y hace zoom pero no se mueve ni tiene pausa.
 * El servicio y el panel consultan esto para no ofrecer lo que no existe.
 */
export interface CameraCapabilities {
  record: boolean;
  /** Pausar/reanudar una grabación sin cerrarla. Sin ella, descanso = STOP + REC. */
  pause: boolean;
  pan: boolean;
  zoom: boolean;
}

export const FULL_CAMERA_CAPABILITIES: Readonly<CameraCapabilities> = Object.freeze({
  record: true,
  pause: true,
  pan: true,
  zoom: true,
});

export type CameraZone = 'FAR_LEFT' | 'LEFT' | 'CENTER' | 'RIGHT' | 'FAR_RIGHT';

/** Zonas del MVP+1. `FAR_*` quedan definidas para ampliar sin cambiar tipos. */
export const BASIC_CAMERA_ZONES: readonly CameraZone[] = ['LEFT', 'CENTER', 'RIGHT'];
export const ALL_CAMERA_ZONES: readonly CameraZone[] = [
  'FAR_LEFT',
  'LEFT',
  'CENTER',
  'RIGHT',
  'FAR_RIGHT',
];

/** Posición física calibrada del gimbal. Unidades: grados; zoom normalizado 0..1. */
export interface CameraPosition {
  pan: number;
  tilt: number;
  zoom?: number;
}

export type CameraConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type CameraRecordingState = 'idle' | 'recording' | 'paused';

export interface CameraStatus {
  connection: CameraConnectionState;
  recording: CameraRecordingState;
  /** Identificador de la grabación en curso (se genera en startRecording). */
  recordingId: string | null;
  zone: CameraZone | null;
  position: CameraPosition | null;
  /** 0..1 */
  zoom: number;
  panning: 'left' | 'right' | null;
  error: string | null;
  updatedAt: number;
}

/**
 * Adaptador de hardware. Todas las operaciones son asíncronas y NUNCA deben
 * bloquear la interfaz del partido: el que las llama no espera a la cámara
 * para actualizar jugadores ni tiempos.
 *
 * Convención: una orden fuera de `capabilities` se rechaza con
 * `CameraError('UNSUPPORTED')` sin cambiar el estado. `zone` y `recordingId`
 * del estado los gestiona el servicio; el adaptador puede dejarlos en null.
 */
export interface CameraController {
  readonly deviceType: CameraDeviceType;
  readonly capabilities: Readonly<CameraCapabilities>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  startRecording(): Promise<void>;
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  stopRecording(): Promise<void>;

  panLeft(): Promise<void>;
  panRight(): Promise<void>;
  stopPan(): Promise<void>;

  recenter(): Promise<void>;
  goToPosition(position: CameraPosition, transitionMs?: number): Promise<void>;

  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  /** @param value 0..1 */
  setZoom(value: number): Promise<void>;

  getStatus(): CameraStatus;
  /** Notifica cada cambio de estado. Devuelve la función para desuscribirse. */
  subscribe(listener: (status: CameraStatus) => void): () => void;
}

/** Configuración de cámara POR PARTIDO. Opcional: la app funciona sin ella. */
export interface CameraSettings {
  enabled: boolean;
  mode: CameraMode;
  deviceType: CameraDeviceType | null;
  zones: Record<CameraZone, CameraPosition | null>;
  smoothTransitionMs: number;
  zoomEnabled: boolean;
  /**
   * Futuro: iniciar/pausar/parar la grabación siguiendo el reloj del partido.
   * Siempre false en el MVP; la automatización existe pero no se registra.
   */
  autoRecord: boolean;
}

export const DEFAULT_CAMERA_SETTINGS: Readonly<CameraSettings> = Object.freeze({
  enabled: false,
  mode: 'external',
  deviceType: null,
  zones: {
    FAR_LEFT: null,
    LEFT: null,
    CENTER: null,
    RIGHT: null,
    FAR_RIGHT: null,
  },
  smoothTransitionMs: 1500,
  zoomEnabled: false,
  autoRecord: false,
});

/** Eventos que publica el módulo de cámara en el EventBus. */
export interface CameraEventMap {
  'camera.connection.changed': { status: CameraStatus; timestamp: number };
  'camera.record.started': { recordingId: string; deviceType: CameraDeviceType | null; timestamp: number };
  'camera.record.paused': { recordingId: string; timestamp: number };
  'camera.record.resumed': { recordingId: string; timestamp: number };
  'camera.record.stopped': { recordingId: string; timestamp: number };
  'camera.zone.changed': { zone: CameraZone; previousZone: CameraZone | null; timestamp: number };
  'camera.error': { code: CameraErrorCode | null; message: string; timestamp: number };
}

export class CameraError extends Error {
  constructor(
    public readonly code: CameraErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export type CameraErrorCode =
  | 'NOT_CONNECTED'
  | 'ALREADY_CONNECTED'
  | 'NOT_RECORDING'
  | 'ALREADY_RECORDING'
  | 'ZONE_NOT_CALIBRATED'
  | 'UNSUPPORTED'
  | 'DEVICE_ERROR';
