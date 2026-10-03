import {
  ALL_CAMERA_ZONES,
  CAMERA_DEVICE_TYPES,
  CAMERA_MODES,
  DEFAULT_CAMERA_SETTINGS,
  type CameraDeviceType,
  type CameraMode,
  type CameraPosition,
  type CameraSettings,
  type CameraZone,
} from './types';

/**
 * Normalización de `cameraSettings`.
 *
 * La configuración llega de fuera (JSON en SQLite, pantallas de ajustes,
 * versiones antiguas de la app) y puede faltar, estar incompleta o traer
 * valores imposibles. La app tiene que funcionar igual: cualquier cosa que no
 * se entienda se sustituye por el valor por defecto, campo a campo, sin tirar
 * el resto de la configuración.
 */

function isCameraMode(value: unknown): value is CameraMode {
  return typeof value === 'string' && (CAMERA_MODES as readonly string[]).includes(value);
}

function isDeviceType(value: unknown): value is CameraDeviceType {
  return typeof value === 'string' && (CAMERA_DEVICE_TYPES as readonly string[]).includes(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Zoom normalizado 0..1: fuera de rango se recorta, no se descarta la posición. */
export function clampZoom(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Una posición calibrada necesita pan y tilt numéricos; el zoom es opcional. */
function normalizePosition(value: unknown): CameraPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const { pan, tilt, zoom } = value as Record<string, unknown>;
  if (!isFiniteNumber(pan) || !isFiniteNumber(tilt)) return null;
  return isFiniteNumber(zoom) ? { pan, tilt, zoom: clampZoom(zoom) } : { pan, tilt };
}

function normalizeZones(value: unknown): Record<CameraZone, CameraPosition | null> {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const zones = { ...DEFAULT_CAMERA_SETTINGS.zones };
  // Solo las zonas conocidas: una clave extra en el JSON no debe colarse en el tipo.
  for (const zone of ALL_CAMERA_ZONES) zones[zone] = normalizePosition(raw[zone]);
  return zones;
}

/** Duración en ms: negativa, NaN o no numérica → valor por defecto. */
function asDurationMs(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value >= 0 ? value : fallback;
}

export function normalizeCameraSettings(
  input?: Partial<CameraSettings> | null | undefined,
): CameraSettings {
  // Se trata como datos sin tipar: el tipo estático no garantiza nada si viene de JSON.
  const raw: Record<string, unknown> =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const defaults = DEFAULT_CAMERA_SETTINGS;

  return {
    enabled: asBoolean(raw.enabled, defaults.enabled),
    mode: isCameraMode(raw.mode) ? raw.mode : defaults.mode,
    deviceType: isDeviceType(raw.deviceType) ? raw.deviceType : defaults.deviceType,
    zones: normalizeZones(raw.zones),
    smoothTransitionMs: asDurationMs(raw.smoothTransitionMs, defaults.smoothTransitionMs),
    zoomEnabled: asBoolean(raw.zoomEnabled, defaults.zoomEnabled),
    autoRecord: asBoolean(raw.autoRecord, defaults.autoRecord),
  };
}

/**
 * ¿Debe la app mandar órdenes a la cámara? En modo `external` (el MVP) la
 * cámara se maneja desde fuera y la app solo informa: ninguna operación toca
 * el hardware aunque haya un controlador adjunto.
 */
export function isCameraControlAvailable(settings: CameraSettings): boolean {
  return settings.enabled && settings.mode !== 'external';
}
