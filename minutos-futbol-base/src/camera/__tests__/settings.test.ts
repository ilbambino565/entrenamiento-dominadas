import { clampZoom, isCameraControlAvailable, normalizeCameraSettings } from '../settings';
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from '../types';

/** Para colar valores imposibles sin que el tipo lo impida (como haría un JSON). */
const raw = (value: unknown) => normalizeCameraSettings(value as Partial<CameraSettings>);

describe('normalizeCameraSettings', () => {
  it('sin entrada (undefined / null / {}) devuelve los valores por defecto', () => {
    expect(normalizeCameraSettings()).toEqual(DEFAULT_CAMERA_SETTINGS);
    expect(normalizeCameraSettings(null)).toEqual(DEFAULT_CAMERA_SETTINGS);
    expect(normalizeCameraSettings({})).toEqual(DEFAULT_CAMERA_SETTINGS);
  });

  it('devuelve objetos nuevos: no comparte zones con DEFAULT_CAMERA_SETTINGS', () => {
    const settings = normalizeCameraSettings();
    expect(settings).not.toBe(DEFAULT_CAMERA_SETTINGS);
    expect(settings.zones).not.toBe(DEFAULT_CAMERA_SETTINGS.zones);
    settings.zones.LEFT = { pan: 1, tilt: 1 };
    expect(DEFAULT_CAMERA_SETTINGS.zones.LEFT).toBeNull();
  });

  it('una entrada parcial completa el resto con los valores por defecto', () => {
    const settings = normalizeCameraSettings({
      enabled: true,
      mode: 'zones',
      deviceType: 'dummy',
      zones: { LEFT: { pan: -30, tilt: 5 } } as CameraSettings['zones'],
    });
    expect(settings).toEqual({
      ...DEFAULT_CAMERA_SETTINGS,
      enabled: true,
      mode: 'zones',
      deviceType: 'dummy',
      zones: { ...DEFAULT_CAMERA_SETTINGS.zones, LEFT: { pan: -30, tilt: 5 } },
    });
  });

  it('un valor no reconocido vuelve al valor por defecto, campo a campo', () => {
    expect(raw({ mode: 'bogus' }).mode).toBe('external');
    expect(raw({ mode: 42 }).mode).toBe('external');
    expect(raw({ deviceType: 'gopro' }).deviceType).toBeNull();
    expect(raw({ enabled: 'yes' }).enabled).toBe(false);
    expect(raw({ zoomEnabled: 1 }).zoomEnabled).toBe(false);
    expect(raw({ autoRecord: 'true' }).autoRecord).toBe(false);
    expect(raw('texto')).toEqual(DEFAULT_CAMERA_SETTINGS);
    expect(raw(7)).toEqual(DEFAULT_CAMERA_SETTINGS);
  });

  it('smoothTransitionMs negativo, NaN o no numérico → 1500; 0 es válido', () => {
    expect(raw({ smoothTransitionMs: -1 }).smoothTransitionMs).toBe(1500);
    expect(raw({ smoothTransitionMs: Number.NaN }).smoothTransitionMs).toBe(1500);
    expect(raw({ smoothTransitionMs: Number.POSITIVE_INFINITY }).smoothTransitionMs).toBe(1500);
    expect(raw({ smoothTransitionMs: '800' }).smoothTransitionMs).toBe(1500);
    expect(raw({ smoothTransitionMs: 0 }).smoothTransitionMs).toBe(0);
    expect(raw({ smoothTransitionMs: 800 }).smoothTransitionMs).toBe(800);
  });

  it('zones: ignora claves desconocidas y descarta posiciones inválidas', () => {
    const settings = raw({
      zones: {
        TOP: { pan: 0, tilt: 0 },
        LEFT: { pan: '-30', tilt: 0 },
        CENTER: { pan: 0, tilt: 0, zoom: 2 },
        RIGHT: { pan: 30, tilt: 0, zoom: Number.NaN },
        FAR_RIGHT: null,
        FAR_LEFT: 'x',
      },
    });
    expect(Object.keys(settings.zones).sort()).toEqual(
      ['FAR_LEFT', 'LEFT', 'CENTER', 'RIGHT', 'FAR_RIGHT'].sort(),
    );
    expect(settings.zones.LEFT).toBeNull();
    expect(settings.zones.CENTER).toEqual({ pan: 0, tilt: 0, zoom: 1 });
    expect(settings.zones.RIGHT).toEqual({ pan: 30, tilt: 0 });
    expect(settings.zones.FAR_RIGHT).toBeNull();
    expect(settings.zones.FAR_LEFT).toBeNull();
  });

  it('zones que no es un objeto → todas a null', () => {
    expect(raw({ zones: 'nada' }).zones).toEqual(DEFAULT_CAMERA_SETTINGS.zones);
    expect(raw({ zones: null }).zones).toEqual(DEFAULT_CAMERA_SETTINGS.zones);
  });

  it('es idempotente', () => {
    const once = normalizeCameraSettings({ enabled: true, mode: 'auto', smoothTransitionMs: 300 });
    expect(normalizeCameraSettings(once)).toEqual(once);
  });
});

describe('isCameraControlAvailable', () => {
  it('solo con enabled y un modo distinto de external', () => {
    expect(isCameraControlAvailable(normalizeCameraSettings())).toBe(false);
    expect(isCameraControlAvailable(normalizeCameraSettings({ enabled: true }))).toBe(false);
    expect(isCameraControlAvailable(normalizeCameraSettings({ mode: 'zones' }))).toBe(false);
    expect(isCameraControlAvailable(normalizeCameraSettings({ enabled: true, mode: 'zones' }))).toBe(true);
    expect(isCameraControlAvailable(normalizeCameraSettings({ enabled: true, mode: 'auto' }))).toBe(true);
  });
});

describe('clampZoom', () => {
  it('acota a 0..1', () => {
    expect(clampZoom(-0.5)).toBe(0);
    expect(clampZoom(0.25)).toBe(0.25);
    expect(clampZoom(3)).toBe(1);
  });
});
