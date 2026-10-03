import { useColorScheme, type TextStyle } from 'react-native';

/**
 * Tema de la app: dos paletas de alto contraste (sol de mediodía y partidos
 * de tarde) y las medidas que fija el diseño (docs/05 §5.4): fichas de 64 dp,
 * botones de al menos 56 dp y reloj grande con cifras tabulares.
 */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  amber: string;
  /** Texto sobre `amber` (relleno del portero): el blanco no llega a AA en claro. */
  onAmber: string;
  neutralRing: string;
  grass: string;
  grassLine: string;
  benchHighlight: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  sizes: typeof SIZES;
}

export const SIZES = {
  token: 64,
  buttonHeight: 56,
  clockFont: 60,
  gap: 12,
  radius: 12,
} as const;

/** Cifras que no "bailan" al cambiar de dígito. */
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export const LIGHT: Theme = {
  dark: false,
  colors: {
    background: '#f4f6f8',
    surface: '#ffffff',
    surfaceRaised: '#e9edf2',
    text: '#0f172a',
    textMuted: '#4b5563',
    accent: '#1d4ed8',
    onAccent: '#ffffff',
    danger: '#b91c1c',
    amber: '#d97706',
    onAmber: '#0f172a',
    neutralRing: '#9ca3af',
    grass: '#2f8f46',
    grassLine: '#ffffff',
    // Tinte que se nota al sol pero deja la ficha azul legible encima (3,7:1).
    benchHighlight: '#93c5fd',
  },
  sizes: SIZES,
};

export const DARK: Theme = {
  dark: true,
  colors: {
    background: '#0b1220',
    surface: '#151e2e',
    surfaceRaised: '#1f2a3d',
    text: '#f8fafc',
    textMuted: '#9ca3af',
    accent: '#60a5fa',
    onAccent: '#0b1220',
    danger: '#f87171',
    amber: '#fbbf24',
    onAmber: '#0b1220',
    neutralRing: '#6b7280',
    grass: '#1f6b33',
    grassLine: '#e5e7eb',
    benchHighlight: '#1e40af',
  },
  sizes: SIZES,
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
