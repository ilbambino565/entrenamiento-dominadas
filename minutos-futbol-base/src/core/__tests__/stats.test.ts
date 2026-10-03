import { substitutionLog, summarizeMatch } from '../stats';
import { EventFactory, F7_SQUAD, MINUTE, STARTERS, T0, run, voided } from './helpers';

describe('summarizeMatch', () => {
  it('ordena por convocatoria (y luego añadidos), nunca por minutos', () => {
    const ev = new EventFactory();
    const events = [
      ev.lineup(T0, STARTERS, 'lucas'),
      ev.start(T0),
      ev.add(T0 + MINUTE, 'nico'),
      ev.sub(T0 + 10 * MINUTE, 'nico', 'lucas'),
    ];
    const summary = summarizeMatch(run(events), T0 + 20 * MINUTE);
    expect(summary.players.map((p) => p.playerId)).toEqual([...F7_SQUAD, 'nico']);
    expect(summary.clockMs).toBe(20 * MINUTE);

    const byId = new Map(summary.players.map((p) => [p.playerId, p]));
    expect(byId.get('lucas')).toMatchObject({ playedMs: 10 * MINUTE, share: 0.5, wasStarter: true, entries: 0, onFieldNow: false, addedLate: false });
    expect(byId.get('nico')).toMatchObject({ playedMs: 10 * MINUTE, share: 0.5, wasStarter: false, entries: 1, onFieldNow: true, addedLate: true });
    expect(byId.get('hugo')).toMatchObject({ playedMs: 20 * MINUTE, share: 1, onFieldNow: true });
    expect(byId.get('marco')).toMatchObject({ playedMs: 0, share: 0, onFieldNow: false });
    expect(summary.maxMs).toBe(20 * MINUTE);
    expect(summary.minMs).toBe(0);
    // 6 titulares × 20' + lucas 10' + nico 10' = 140' entre 11 convocados.
    expect(summary.avgMs).toBeCloseTo((140 * MINUTE) / 11, 6);
  });

  it('sin reloj todo es 0 y el convocado que no juega aparece con 0:00', () => {
    const summary = summarizeMatch(run([]), T0);
    expect(summary.clockMs).toBe(0);
    expect(summary.players).toHaveLength(F7_SQUAD.length);
    expect(summary.players.every((p) => p.playedMs === 0 && p.share === 0)).toBe(true);
    expect(summary).toMatchObject({ maxMs: 0, minMs: 0, avgMs: 0 });
  });
});

describe('substitutionLog', () => {
  it('lista entradas, salidas y cambios no anulados en orden de seq', () => {
    const ev = new EventFactory();
    const sub = { ...ev.sub(T0 + 10 * MINUTE, 'marco', 'lucas'), matchTimeMs: 10 * MINUTE, period: 1 };
    const leave = { ...ev.leave(T0 + 12 * MINUTE, 'hugo'), matchTimeMs: 12 * MINUTE, period: 1 };
    const goal = ev.goal(T0 + 13 * MINUTE, 'mateo');
    const undoneSub = voided({ ...ev.sub(T0 + 14 * MINUTE, 'adrian', 'leo'), matchTimeMs: 14 * MINUTE, period: 1 });
    const enter = { ...ev.enter(T0 + 30 * MINUTE, 'david'), matchTimeMs: 25 * MINUTE, period: 2 };
    expect(substitutionLog([enter, undoneSub, goal, leave, sub])).toEqual([
      { matchTimeMs: 10 * MINUTE, period: 1, inPlayerId: 'marco', outPlayerId: 'lucas', eventId: sub.id, type: 'SUBSTITUTION' },
      { matchTimeMs: 12 * MINUTE, period: 1, inPlayerId: null, outPlayerId: 'hugo', eventId: leave.id, type: 'PLAYER_LEFT' },
      { matchTimeMs: 25 * MINUTE, period: 2, inPlayerId: 'david', outPlayerId: null, eventId: enter.id, type: 'PLAYER_ENTERED' },
    ]);
  });
});
