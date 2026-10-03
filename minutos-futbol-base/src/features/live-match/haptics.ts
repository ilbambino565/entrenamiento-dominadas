import * as Haptics from 'expo-haptics';

/**
 * Háptica "si se puede": en web no existe y en algún Android falla. Nunca
 * debe romper un gesto, así que todo va envuelto y se ignora el error.
 */
function safely(run: () => Promise<void>): void {
  try {
    run().catch(() => undefined);
  } catch {
    // Sin háptica: no pasa nada.
  }
}

export const haptics = {
  dragStart: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  targetChanged: () => safely(() => Haptics.selectionAsync()),
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
