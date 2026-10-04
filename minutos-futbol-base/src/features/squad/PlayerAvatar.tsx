import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../ui/theme';

/**
 * Avatar de la plantilla: círculo con la foto (data URI o archivo) o, si no
 * la hay, el dorsal grande sobre el color del equipo (ámbar si es portero),
 * como la ficha del partido pero sin tiempos ni anillo. Sin dorsal se pinta
 * la inicial del nombre, y sin nada, "?".
 */
export const AVATAR_SIZE = 48;

export interface PlayerAvatarProps {
  photoUri: string | null;
  shirtNumber: number | null;
  isGoalkeeper: boolean;
  /** Respaldo cuando no hay foto ni dorsal: la inicial del nombre. */
  initial?: string;
  size?: number;
  testID?: string;
}

export function PlayerAvatar({ photoUri, shirtNumber, isGoalkeeper, initial, size = AVATAR_SIZE, testID = 'player-avatar' }: PlayerAvatarProps) {
  const { colors } = useTheme();
  const fill = isGoalkeeper ? colors.amber : colors.accent;
  const onFill = isGoalkeeper ? colors.onAmber : colors.onAccent;
  const round = { width: size, height: size, borderRadius: size / 2 };
  const label = shirtNumber !== null ? String(shirtNumber) : (initial ?? '').trim().charAt(0).toUpperCase() || '?';
  // Dos cifras caben a ~0,42 del diámetro; una inicial igual.
  const fontSize = Math.round(size * 0.42);

  return (
    <View testID={testID} style={[styles.circle, round, { backgroundColor: fill }]}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={[styles.photo, round]} resizeMode="cover" testID={`${testID}-photo`} />
      ) : (
        <Text style={[styles.label, { color: onFill, fontSize, lineHeight: fontSize + 4 }]} testID={`${testID}-label`}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { position: 'absolute', left: 0, top: 0 },
  label: { fontWeight: '800' },
});
