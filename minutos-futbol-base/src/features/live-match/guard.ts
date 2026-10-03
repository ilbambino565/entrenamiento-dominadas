import { MatchRuleError } from '../../core';

export type Notify = (message: string) => void;

/**
 * Envoltorio de TODO comando al motor desde la UI: una regla incumplida se
 * enseña como aviso breve y cualquier otro fallo se registra y se avisa en
 * genérico. La pantalla nunca se cae por un comando. Devuelve si se aplicó.
 */
export async function guarded(run: () => Promise<unknown>, notify: Notify, label = 'la acción'): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    if (error instanceof MatchRuleError) {
      notify(error.message);
    } else {
      console.error('[LiveMatch] fallo al ejecutar', label, error);
      notify(`No se pudo aplicar ${label}`);
    }
    return false;
  }
}
