import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../ui/theme';

export const TOAST_MS = 2500;

/** Aviso breve propio: un texto, 2,5 s, sin librerías. */
export function useToast(durationMs = TOAST_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="toast"
        style={[styles.box, { backgroundColor: colors.text }]}
      >
        <Text style={[styles.text, { color: colors.background }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 24, alignItems: 'center' },
  box: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, maxWidth: 480 },
  text: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
