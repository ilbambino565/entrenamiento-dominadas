import { Platform } from 'react-native';

/**
 * El selector de fotos con los módulos de Expo mockeados: permiso, cancelación,
 * recorte centrado, reducción a 256×256 y JPEG 0,8 en data URI.
 */
// Prefijo `mock`: jest.mock se eleva por encima de estas constantes y solo permite referenciar variables así llamadas.
const mockRequestPermission = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockContext = { crop: jest.fn(), resize: jest.fn(), renderAsync: jest.fn(), release: jest.fn() };
const mockRendered = { saveAsync: jest.fn(), release: jest.fn() };
const mockManipulate = jest.fn((_uri: string) => mockContext);

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestPermission(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { GALLERY_PERMISSION_DENIED, PHOTO_SIZE, centeredSquareCrop, pickPlayerPhoto } from '../photoPicker';

const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
const denied = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestPermission.mockResolvedValue(granted);
  mockContext.renderAsync.mockResolvedValue(mockRendered);
  mockRendered.saveAsync.mockResolvedValue({ uri: 'file:///cache/x.jpg', width: 256, height: 256, base64: 'QUJD' });
});

describe('pickPlayerPhoto', () => {
  it('PHOTO_SIZE es 256', () => {
    expect(PHOTO_SIZE).toBe(256);
  });

  it('con permiso denegado lanza el error en español y no abre la galería', async () => {
    mockRequestPermission.mockResolvedValue(denied);
    await expect(pickPlayerPhoto()).rejects.toThrow(GALLERY_PERMISSION_DENIED);
    await expect(pickPlayerPhoto()).rejects.toThrow('Sin permiso para abrir la galería');
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('cancelar devuelve null sin procesar nada', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickPlayerPhoto()).resolves.toBeNull();
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('abre la galería solo con imágenes y recorte cuadrado, recorta al centro, reduce a 256×256 y devuelve un data URI JPEG', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///pick.png', width: 800, height: 600 }] });
    await expect(pickPlayerPhoto()).resolves.toBe('data:image/jpeg;base64,QUJD');

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockLaunchLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], allowsMultipleSelection: false }));
    expect(mockManipulate).toHaveBeenCalledWith('file:///pick.png');
    expect(mockContext.crop).toHaveBeenCalledWith({ originX: 100, originY: 0, width: 600, height: 600 });
    expect(mockContext.resize).toHaveBeenCalledWith({ width: 256, height: 256 });
    expect(mockRendered.saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8, base64: true });
    // Los objetos nativos se liberan.
    expect(mockRendered.release).toHaveBeenCalledTimes(1);
    expect(mockContext.release).toHaveBeenCalledTimes(1);
  });

  it('una imagen ya cuadrada (o sin medidas) no se recorta', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///sq.jpg', width: 500, height: 500 }] });
    await pickPlayerPhoto();
    expect(mockContext.crop).not.toHaveBeenCalled();
    expect(centeredSquareCrop({ width: 0, height: 0 })).toBeNull();
    expect(centeredSquareCrop({ width: 300, height: 1000 })).toEqual({ originX: 0, originY: 350, width: 300, height: 300 });
  });

  it('si el manipulador no devuelve base64, falla con mensaje en español y aun así libera los recursos', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///pick.png', width: 10, height: 10 }] });
    mockRendered.saveAsync.mockResolvedValue({ uri: 'file:///x.jpg', width: 256, height: 256 });
    await expect(pickPlayerPhoto()).rejects.toThrow('No se pudo procesar la foto');
    expect(mockRendered.release).toHaveBeenCalledTimes(1);
    expect(mockContext.release).toHaveBeenCalledTimes(1);
  });

  it('en web no pide permiso de galería', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
      await expect(pickPlayerPhoto()).resolves.toBeNull();
      expect(mockRequestPermission).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });
});
