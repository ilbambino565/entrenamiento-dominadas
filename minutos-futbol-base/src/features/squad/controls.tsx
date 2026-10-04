import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions, type ReturnKeyTypeOptions } from 'react-native';
import type { PlayerIssue } from '../../core/squad';
import { SIZES, useTheme } from '../../ui/theme';

/**
 * Controles compartidos por las pantallas de plantilla (P2-P4). Fijan las
 * medidas de docs/05 §5.4 en un solo sitio: acción principal ≥ 56 dp, acción
 * secundaria (chips, flechas, casillas) ≥ 44 dp, y los colores del tema.
 */
export const PRIMARY_HEIGHT = SIZES.buttonHeight;
export const SECONDARY_HEIGHT = 44;
/** Texto de aviso en el tema claro: el ámbar del tema (#d97706) solo da 2,9:1 sobre el fondo. */
export const WARNING_TEXT_LIGHT = '#92400e';

export interface BigButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  tone?: 'accent' | 'danger';
}

/** Botón de acción principal: relleno, mayúsculas, ≥ 56 dp. */
export function BigButton({ label, onPress, testID, disabled = false, accessibilityLabel, tone = 'accent' }: BigButtonProps) {
  const { colors, dark } = useTheme();
  const background = tone === 'danger' ? colors.danger : colors.accent;
  // En oscuro `danger` es un rojo claro: el texto va oscuro para llegar a AA.
  const foreground = tone === 'danger' ? (dark ? '#0b1220' : '#ffffff') : colors.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={[styles.bigButton, { backgroundColor: background }, disabled && styles.disabled]}
    >
      <Text style={[styles.bigButtonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}

/** Opción excluyente (formato, dibujo, modo de nombres). Guarda al tocar. */
export function Chip({ label, selected, onPress, testID, disabled = false }: ChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.chip,
        { borderColor: selected ? colors.accent : colors.neutralRing, backgroundColor: selected ? colors.accent : colors.surface },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Fila de chips con salto de línea. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/** Problema de validación bajo un campo: rojo si bloquea, ámbar si es aviso. */
export function IssueText({ issue }: { issue: PlayerIssue }) {
  const { colors, dark } = useTheme();
  // El ámbar del tema claro no llega a AA como texto (2,9:1): aviso en marrón ámbar (7:1).
  const color = issue.level === 'error' ? colors.danger : dark ? colors.amber : WARNING_TEXT_LIGHT;
  return (
    <Text accessibilityRole="text" accessibilityLiveRegion="polite" testID={`issue-${issue.field}-${issue.code}`} style={[styles.issue, { color }]}>
      {issue.message}
    </Text>
  );
}

export interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  onBlur?: () => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  issues?: readonly PlayerIssue[];
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Para encadenar campos con el teclado ("siguiente") y enfocar el primero al abrir la ficha. */
  inputRef?: Ref<TextInput>;
  autoFocus?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
}

/** Etiqueta + campo de texto de 56 dp + sus problemas debajo. */
export function FormField({
  label,
  value,
  onChangeText,
  testID,
  onBlur,
  placeholder,
  keyboardType,
  maxLength,
  issues = [],
  autoCapitalize = 'words',
  inputRef,
  autoFocus = false,
  returnKeyType,
  onSubmitEditing,
}: FormFieldProps) {
  const { colors } = useTheme();
  const hasError = issues.some((i) => i.level === 'error');
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={returnKeyType !== 'next'}
        placeholder={placeholder}
        placeholderTextColor={colors.neutralRing}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        testID={testID}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: hasError ? colors.danger : colors.neutralRing },
        ]}
      />
      {issues.map((issue) => (
        <IssueText key={`${issue.field}-${issue.code}`} issue={issue} />
      ))}
    </View>
  );
}

export interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Va en el interruptor (los tests lo usan); la fila lleva `<testID>-row`. */
  testID: string;
  trackColor?: string;
}

/**
 * Interruptor con toda la fila tocable (56 dp): el Switch solo mide 20-31 dp
 * y, de pie y con una mano, se falla. Tocar la etiqueta también cambia el valor.
 */
export function ToggleRow({ label, value, onValueChange, testID, trackColor }: ToggleRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      testID={`${testID}-row`}
      style={styles.labelledRow}
    >
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} testID={testID} trackColor={{ true: trackColor ?? colors.accent }} />
    </Pressable>
  );
}

/** Fila "etiqueta + interruptor" u otra pareja etiqueta/control, de 56 dp. */
export function LabelledRow({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.labelledRow}>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bigButton: {
    minHeight: PRIMARY_HEIGHT,
    borderRadius: SIZES.radius,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigButtonText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  disabled: { opacity: 0.5 },
  chip: {
    minHeight: SECONDARY_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: SECONDARY_HEIGHT / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 15, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  issue: { fontSize: 14, lineHeight: 18, marginTop: 4, fontWeight: '600' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    minHeight: PRIMARY_HEIGHT,
    borderWidth: 1.5,
    borderRadius: SIZES.radius,
    paddingHorizontal: 14,
    fontSize: 18,
  },
  labelledRow: {
    minHeight: PRIMARY_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rowLabel: { fontSize: 17, fontWeight: '600' },
});
