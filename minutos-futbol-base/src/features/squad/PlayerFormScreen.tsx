import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SquadError, type SquadService } from '../../app-services/squadService';
import {
  FIRST_NAME_MAX_LENGTH,
  LAST_NAME_MAX_LENGTH,
  SHIRT_NUMBER_MAX,
  SHIRT_NUMBER_MIN,
  hasBlockingIssues,
  normalizePlayerDraft,
  validatePlayerDraft,
  type PlayerIssue,
  type PlayerIssueField,
} from '../../core/squad';
import type { Player, PlayerDraft } from '../../core/team';
import { SIZES, useTheme } from '../../ui/theme';
import { BigButton, FormField, IssueText, LabelledRow, PRIMARY_HEIGHT, SECONDARY_HEIGHT } from './controls';
import { pickPlayerPhoto } from './photoPicker';
import { PlayerAvatar } from './PlayerAvatar';
import { errorMessage, useSquadScreenState } from './useSquadState';

/**
 * P3 "Jugador" (docs/05 §5.3): alta y edición de la ficha. La validación es
 * la del dominio (`validatePlayerDraft`) y se muestra en vivo, pero cada
 * problema solo aparece cuando el campo se ha tocado o se ha intentado
 * guardar: una ficha nueva no debe abrirse ya en rojo. Los avisos (dorsal
 * repetido) se ven en ámbar y dejan guardar; los errores bloquean.
 *
 * Eliminar es un derecho de supresión (docs/01 §1.4): la confirmación va en
 * dos pasos dentro de la misma pantalla (sin diálogo nativo, que en web y en
 * los tests se comporta distinto) y explica qué se borra y qué se conserva.
 */
export interface PlayerFormScreenProps {
  service: SquadService;
  /** Sin id (o null) es un alta. */
  playerId?: string | null;
  /** Volver: tras guardar, tras eliminar o con ← sin guardar. */
  onDone: () => void;
}

export const PHOTO_BUTTON_SIZE = 96;
export const DELETE_EXPLANATION = 'Se borran su nombre y su foto; sus minutos pasados se conservan';

export function PlayerFormScreen({ service, playerId = null, onDone }: PlayerFormScreenProps) {
  const { colors } = useTheme();
  const state = useSquadScreenState(service);
  const player = playerId ? (state.players.find((p) => p.id === playerId) ?? null) : null;

  if (playerId && !player) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <Header title="Jugador" onBack={onDone} />
        <View style={styles.center}>
          {state.status === 'loading' ? (
            <ActivityIndicator color={colors.accent} testID="player-loading" />
          ) : (
            <Text style={[styles.centerText, { color: colors.danger }]} testID="player-missing">
              {state.status === 'error' ? (state.error ?? 'No se pudo cargar la plantilla') : 'Jugador no encontrado'}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // La clave reinicia el formulario si cambia el jugador que se edita.
  return <PlayerForm key={player?.id ?? 'new'} service={service} player={player} others={state.players} onDone={onDone} />;
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver sin guardar" testID="back" style={styles.backButton}>
        <Text style={[styles.backText, { color: colors.accent }]}>←</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" testID="player-form-title">
        {title}
      </Text>
    </View>
  );
}

interface PlayerFormProps {
  service: SquadService;
  player: Player | null;
  others: readonly Player[];
  onDone: () => void;
}

/** Texto del campo Dorsal → número: vacío = sin dorsal; no numérico = NaN (error local). */
export function parseShirtNumber(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

const SHIRT_NOT_A_NUMBER: PlayerIssue = {
  field: 'shirtNumber',
  code: 'RANGE',
  level: 'error',
  message: `El dorsal debe ser un número entero entre ${SHIRT_NUMBER_MIN} y ${SHIRT_NUMBER_MAX}`,
};

function PlayerForm({ service, player, others, onDone }: PlayerFormProps) {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState(player?.firstName ?? '');
  const [lastName, setLastName] = useState(player?.lastName ?? '');
  const [shirtText, setShirtText] = useState(player?.shirtNumber !== null && player?.shirtNumber !== undefined ? String(player.shirtNumber) : '');
  const [isGoalkeeper, setGoalkeeper] = useState(player?.isGoalkeeper ?? false);
  const [isActive, setActive] = useState(player?.isActive ?? true);
  const [photoUri, setPhotoUri] = useState<string | null>(player?.photoUri ?? null);
  const [photoConsent, setPhotoConsent] = useState(player?.photoConsent ?? false);
  const [touched, setTouched] = useState<Partial<Record<PlayerIssueField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const draft: PlayerDraft = useMemo(
    () => ({ firstName, lastName, shirtNumber: parseShirtNumber(shirtText), isGoalkeeper, isActive, photoUri, photoConsent }),
    [firstName, lastName, shirtText, isGoalkeeper, isActive, photoUri, photoConsent],
  );

  const issues = useMemo(() => {
    const list = validatePlayerDraft(draft, others, player?.id);
    return Number.isNaN(draft.shirtNumber) ? [...list, SHIRT_NOT_A_NUMBER] : list;
  }, [draft, others, player?.id]);

  const touch = useCallback((field: PlayerIssueField) => setTouched((t) => (t[field] ? t : { ...t, [field]: true })), []);
  const visibleIssues = useCallback(
    (field: PlayerIssueField) => (attempted || touched[field] ? issues.filter((i) => i.field === field) : []),
    [attempted, touched, issues],
  );

  const choosePhoto = useCallback(async () => {
    setPhotoError(null);
    try {
      const uri = await pickPlayerPhoto();
      if (!alive.current || uri === null) return;
      setPhotoUri(uri);
      touch('photo');
    } catch (error: unknown) {
      if (alive.current) setPhotoError(errorMessage(error, 'No se pudo elegir la foto'));
    }
  }, [touch]);

  const removePhoto = useCallback(() => {
    setPhotoUri(null);
    setPhotoError(null);
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    setAttempted(true);
    if (hasBlockingIssues(issues)) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const normalized = normalizePlayerDraft(draft);
      if (player) await service.updatePlayer(player.id, normalized);
      else await service.addPlayer(normalized);
      onDone();
    } catch (error: unknown) {
      if (!alive.current) return;
      setSubmitError(error instanceof SquadError && error.issues.length > 0 ? error.issues.map((i) => i.message).join('\n') : errorMessage(error, 'No se pudo guardar'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, issues, draft, player, service, onDone]);

  const confirmDelete = useCallback(async () => {
    if (!player || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await service.removePlayer(player.id);
      onDone();
    } catch (error: unknown) {
      if (alive.current) setSubmitError(errorMessage(error, 'No se pudo eliminar'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [player, busy, service, onDone]);

  const photoIssues = visibleIssues('photo');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Header title={player ? 'Jugador' : 'Nuevo jugador'} onBack={onDone} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.photoBlock}>
            <Pressable
              onPress={() => void choosePhoto()}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? 'Cambiar la foto' : 'Elegir una foto de la galería'}
              testID="photo-button"
              style={styles.photoButton}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" testID="photo-preview" />
              ) : (
                <PlayerAvatar photoUri={null} shirtNumber={draft.shirtNumber === null || Number.isNaN(draft.shirtNumber) ? null : draft.shirtNumber} isGoalkeeper={isGoalkeeper} initial={firstName} size={PHOTO_BUTTON_SIZE} testID="photo-placeholder" />
              )}
            </Pressable>
            <Text style={[styles.photoHint, { color: colors.textMuted }]}>{photoUri ? 'Toca para cambiarla' : 'Toca para elegir una foto'}</Text>
            {photoUri ? (
              <Pressable onPress={removePhoto} accessibilityRole="button" testID="remove-photo" style={styles.textButton}>
                <Text style={[styles.textButtonLabel, { color: colors.accent }]}>Quitar foto</Text>
              </Pressable>
            ) : null}
            {photoError ? (
              <Text accessibilityRole="alert" style={[styles.photoError, { color: colors.danger }]} testID="photo-error">
                {photoError}
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={() => {
              setPhotoConsent((v) => !v);
              touch('photo');
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: photoConsent }}
            accessibilityLabel="Tengo consentimiento para usar la foto"
            testID="consent"
            style={styles.checkboxRow}
          >
            <View style={[styles.checkbox, { borderColor: photoConsent ? colors.accent : colors.neutralRing, backgroundColor: photoConsent ? colors.accent : colors.surface }]}>
              {photoConsent ? <Text style={[styles.checkmark, { color: colors.onAccent }]}>✓</Text> : null}
            </View>
            <Text style={[styles.checkboxLabel, { color: colors.text }]}>Tengo consentimiento para usar la foto</Text>
          </Pressable>
          {photoIssues.map((issue) => (
            <IssueText key={issue.code} issue={issue} />
          ))}

          <View style={styles.fields}>
            <FormField
              label="Nombre*"
              value={firstName}
              onChangeText={(t) => {
                setFirstName(t);
                touch('firstName');
              }}
              onBlur={() => touch('firstName')}
              testID="first-name"
              maxLength={FIRST_NAME_MAX_LENGTH + 10}
              issues={visibleIssues('firstName')}
            />
            <FormField
              label="Apellidos"
              value={lastName}
              onChangeText={(t) => {
                setLastName(t);
                touch('lastName');
              }}
              onBlur={() => touch('lastName')}
              testID="last-name"
              maxLength={LAST_NAME_MAX_LENGTH + 10}
              issues={visibleIssues('lastName')}
            />
            <FormField
              label="Dorsal"
              value={shirtText}
              onChangeText={(t) => {
                setShirtText(t);
                touch('shirtNumber');
              }}
              onBlur={() => touch('shirtNumber')}
              testID="shirt-number"
              keyboardType="number-pad"
              placeholder="Sin dorsal"
              maxLength={3}
              autoCapitalize="none"
              issues={visibleIssues('shirtNumber')}
            />
            <LabelledRow label="Portero">
              <Switch value={isGoalkeeper} onValueChange={setGoalkeeper} accessibilityLabel="Portero" testID="goalkeeper" trackColor={{ true: colors.amber }} />
            </LabelledRow>
            <LabelledRow label="Activo">
              <Switch value={isActive} onValueChange={setActive} accessibilityLabel="Activo" testID="active" trackColor={{ true: colors.accent }} />
            </LabelledRow>
          </View>

          {submitError ? (
            <Text accessibilityRole="alert" style={[styles.submitError, { color: colors.danger }]} testID="submit-error">
              {submitError}
            </Text>
          ) : null}

          <BigButton label="GUARDAR" onPress={() => void save()} disabled={busy} testID="save" />

          {player ? (
            <View style={styles.deleteBlock}>
              {confirmingDelete ? (
                <View style={[styles.deleteConfirm, { borderColor: colors.danger, backgroundColor: colors.surface }]} testID="delete-confirm">
                  <Text style={[styles.deleteExplanation, { color: colors.text }]}>{DELETE_EXPLANATION}</Text>
                  <BigButton label="SÍ, ELIMINAR" onPress={() => void confirmDelete()} disabled={busy} testID="confirm-delete" tone="danger" />
                  <Pressable onPress={() => setConfirmingDelete(false)} accessibilityRole="button" testID="cancel-delete" style={styles.textButton}>
                    <Text style={[styles.textButtonLabel, { color: colors.accent }]}>Cancelar</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setConfirmingDelete(true)} accessibilityRole="button" testID="delete" style={styles.textButton}>
                  <Text style={[styles.textButtonLabel, { color: colors.danger }]}>Eliminar jugador</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  backButton: { minHeight: PRIMARY_HEIGHT, minWidth: PRIMARY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, fontWeight: '700' },
  title: { flex: 1, fontSize: 22, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerText: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  photoBlock: { alignItems: 'center', marginTop: 8, marginBottom: 4 },
  photoButton: { width: PHOTO_BUTTON_SIZE, height: PHOTO_BUTTON_SIZE, borderRadius: PHOTO_BUTTON_SIZE / 2, overflow: 'hidden' },
  photo: { width: PHOTO_BUTTON_SIZE, height: PHOTO_BUTTON_SIZE, borderRadius: PHOTO_BUTTON_SIZE / 2 },
  photoHint: { marginTop: 6, fontSize: 13 },
  photoError: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  checkboxRow: { minHeight: SECONDARY_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  checkbox: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkmark: { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  checkboxLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
  fields: { marginTop: 12 },
  submitError: { marginBottom: 12, fontSize: 15, fontWeight: '600' },
  deleteBlock: { marginTop: 28, alignItems: 'center' },
  deleteConfirm: { alignSelf: 'stretch', borderWidth: 2, borderRadius: SIZES.radius, padding: 16, gap: 12 },
  deleteExplanation: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
  textButton: { minHeight: SECONDARY_HEIGHT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  textButtonLabel: { fontSize: 16, fontWeight: '700' },
});
