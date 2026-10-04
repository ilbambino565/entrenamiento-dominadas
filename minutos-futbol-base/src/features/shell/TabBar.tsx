import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SIZES, useTheme } from '../../ui/theme';

/**
 * Barra de pestañas propia (docs/05 §5.1, nota): tres destinos fijos y nada
 * más. Vive en React, sin Expo Router, hasta que haya varios partidos y
 * enlaces profundos; entonces la sustituye un `(tabs)/_layout.tsx` y las
 * pantallas no cambian. Cada pestaña mide al menos 56 dp (docs/05 §5.4) y
 * respeta el margen inferior del dispositivo.
 */
export type Tab = 'matches' | 'squad' | 'team';

export interface TabItem {
  id: Tab;
  label: string;
  icon: string;
}

export const TABS: readonly TabItem[] = [
  { id: 'matches', label: 'Partidos', icon: '⚽' },
  { id: 'squad', label: 'Plantilla', icon: '👥' },
  { id: 'team', label: 'Equipo', icon: '⚙️' },
];

export const TAB_HEIGHT = SIZES.buttonHeight + 8;

export interface TabBarProps {
  current: Tab;
  onSelect: (tab: Tab) => void;
}

export function TabBar({ current, onSelect }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      testID="tab-bar"
      style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.surfaceRaised, paddingBottom: insets.bottom }]}
    >
      {TABS.map((tab) => {
        const selected = tab.id === current;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            testID={`tab-${tab.id}`}
            style={[styles.tab, selected && { borderTopColor: colors.accent }]}
          >
            <Text style={[styles.icon, !selected && styles.iconIdle]}>{tab.icon}</Text>
            <Text style={[styles.label, { color: selected ? colors.accent : colors.textMuted }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 2 },
  tab: {
    flex: 1,
    minHeight: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
  icon: { fontSize: 22, lineHeight: 26 },
  iconIdle: { opacity: 0.7 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
});
