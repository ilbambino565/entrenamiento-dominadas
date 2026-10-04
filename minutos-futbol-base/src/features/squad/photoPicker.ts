import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * Foto del jugador desde la galería (P3). Privacidad por diseño (docs/01
 * §1.4): la imagen se recorta a un cuadrado, se reduce a 256×256 y se
 * comprime en JPEG, y lo que sale es un data URI que viaja con la fila del
 * jugador (docs/02, `player.photo_uri`): nada queda en archivos sueltos que
 * puedan perderse o copiarse por separado.
 *
 * API de Expo SDK 57: `expo-image-picker` (`requestMediaLibraryPermissionsAsync`,
 * `launchImageLibraryAsync` con `mediaTypes: ['images']`) y la API contextual
 * de `expo-image-manipulator` (`ImageManipulator.manipulate(uri)` →
 * `crop`/`resize` → `renderAsync()` → `ImageRef.saveAsync({ base64 })`).
 */
export const PHOTO_SIZE = 256;
export const PHOTO_QUALITY = 0.8;
export const GALLERY_PERMISSION_DENIED = 'Sin permiso para abrir la galería';
export const PHOTO_PROCESSING_FAILED = 'No se pudo procesar la foto';

/** Lo que hace falta de lo elegido para recortar: la URI y las medidas (0 si el sistema no las da). */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Abre la galería y devuelve la foto ya cuadrada, reducida y en data URI.
 * `null` si el entrenador cancela. Lanza `Error(GALLERY_PERMISSION_DENIED)`
 * si la plataforma pide permiso y se deniega (en web no hay permiso).
 */
export async function pickPlayerPhoto(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(GALLERY_PERMISSION_DENIED);
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Recorte cuadrado donde el sistema lo ofrece (Android/iOS); en web se ignora y recortamos nosotros.
    allowsEditing: true,
    aspect: [1, 1],
    allowsMultipleSelection: false,
    // Sin comprimir aquí: la compresión final la hace el manipulador tras reducir.
    quality: 1,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return toSquareJpegDataUri(asset);
}

/** Cuadrado centrado de lado mínimo; null si la imagen ya es cuadrada o no se conocen sus medidas. */
export function centeredSquareCrop({ width, height }: Pick<PickedImage, 'width' | 'height'>): { originX: number; originY: number; width: number; height: number } | null {
  const side = Math.min(width, height);
  if (!(side > 0) || width === height) return null;
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}

/** Recorta (si hace falta), reduce a PHOTO_SIZE² y guarda en JPEG base64 como data URI. */
export async function toSquareJpegDataUri(image: PickedImage): Promise<string> {
  const context = ImageManipulator.manipulate(image.uri);
  try {
    const crop = centeredSquareCrop(image);
    if (crop) context.crop(crop);
    context.resize({ width: PHOTO_SIZE, height: PHOTO_SIZE });
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: true });
      if (!saved.base64) throw new Error(PHOTO_PROCESSING_FAILED);
      return `data:image/jpeg;base64,${saved.base64}`;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}
