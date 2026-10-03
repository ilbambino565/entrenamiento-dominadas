import type { AppEventMap } from '../../events/topics';
import type { LineupEntry } from '../../core';
import { MINUTE, T0, f7Config, pos } from '../../core/__tests__/helpers';
import { createInMemoryEventStore } from '../../db';
import { createEventBus } from '../../events/bus';
import { createMatchEngine } from '../matchEngine';

/**
 * Reloj del sistema hacia atrás (docs/03 §3.7.9). El dominio es puro y no
 * opina; es la fachada la que acota el instante de consulta a la última marca
 * guardada para que el reloj grande y los jugadores sigan cuadrando.
 */

const FIELD = ['lucas', 'mateo', 'leo', 'daniel', 'pablo', 'alex', 'marco'] as const;
const SUBS = ['hugo', 'adrian', 'david'] as const;
const lineup = (ids: readonly string[]): LineupEntry[] => ids.map((playerId, i) => ({ playerId, position: pos(i) }));

async function kickoff() {
  let t = T0;
  const clock = { now: () => t, set: (ms: number) => void (t = ms) };
  const engine = createMatchEngine({ config: f7Config(), store: createInMemoryEventStore(), bus: createEventBus<AppEventMap>(), now: clock.now });
  await engine.load();
  await engine.setLineup(lineup(FIELD), [...SUBS], T0 - 5 * MINUTE);
  await engine.start();
  return { engine, clock };
}

describe('reloj del sistema hacia atrás', () => {
  it('con now anterior a la última marca guardada, reloj y jugadores en campo cuadran', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 10 * MINUTE);
    await engine.pause();
    // El móvil corrige la hora 4 minutos hacia atrás.
    const now = T0 + 6 * MINUTE;
    expect(engine.clockMs(now)).toBe(10 * MINUTE);
    expect(engine.playedMs('lucas', now)).toBe(10 * MINUTE);
    const summary = engine.summary(now);
    expect(summary.clockMs).toBe(10 * MINUTE);
    for (const p of summary.players) expect(p.playedMs).toBe(p.onFieldNow ? 10 * MINUTE : 0);
  });

  it('salir y volver a entrar con el reloj hacia atrás: nadie suma más que el reloj', async () => {
    const { engine, clock } = await kickoff();
    clock.set(T0 + 10 * MINUTE);
    await engine.leavePlayer('lucas');
    clock.set(T0 + 8 * MINUTE);
    await engine.enterPlayer('lucas', pos(0));
    const now = T0 + 20 * MINUTE;
    expect(engine.clockMs(now)).toBe(20 * MINUTE);
    expect(engine.playedMs('lucas', now)).toBe(20 * MINUTE);
  });

  it('un instante no finito se rechaza también al deshacer', async () => {
    const { engine } = await kickoff();
    await expect(engine.undo(Number.NaN)).rejects.toMatchObject({ name: 'MatchRuleError', code: 'INVALID_EVENT' });
    expect(engine.peekUndo()?.type).toBe('MATCH_STARTED');
  });
});
