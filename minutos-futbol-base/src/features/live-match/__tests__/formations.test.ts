import { reduceMatch } from '../../../core';
import { EventFactory, STARTERS, T0, f7Config, pos } from '../../../core/__tests__/helpers';
import {
  GOALKEEPER_SLOT,
  applyFormation,
  changedPositions,
  formationSlots,
  formationsFor,
  isValidFormation,
  parseFormation,
} from '../formations';

describe('formaciones', () => {
  it('los presets de cada formato suman los jugadores de campo menos el portero', () => {
    for (const [onField, presets] of [
      [7, formationsFor(7)],
      [8, formationsFor(8)],
      [11, formationsFor(11)],
    ] as const) {
      expect(presets.length).toBeGreaterThan(0);
      for (const f of presets) expect(isValidFormation(f, onField)).toBe(true);
    }
    expect(formationsFor(9)).toEqual([]);
  });

  it('parseFormation acepta dígitos separados por guiones y rechaza lo demás', () => {
    expect(parseFormation('3-2-1')).toEqual([3, 2, 1]);
    expect(parseFormation('4-2-3-1')).toEqual([4, 2, 3, 1]);
    expect(parseFormation('3-0-3')).toBeNull();
    expect(parseFormation('3 2 1')).toBeNull();
    expect(parseFormation('')).toBeNull();
    expect(isValidFormation('3-2-1', 8)).toBe(false);
  });

  it('formationSlots va de la defensa (abajo) al ataque (arriba), centrado y dentro del campo', () => {
    const slots = formationSlots('3-2-1');
    expect(slots).toHaveLength(6);
    const [d1, d2, d3, m1, m2, a1] = slots;
    expect([d1?.x, d2?.x, d3?.x]).toEqual([0.2, 0.5, 0.8]);
    expect([m1?.x, m2?.x]).toEqual([0.35, 0.65]);
    expect(a1).toEqual({ x: 0.5, y: 0.22 });
    expect(d1?.y).toBe(0.7);
    expect(m1?.y).toBe(0.46);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0.1);
      expect(s.x).toBeLessThanOrEqual(0.9);
      expect(s.y).toBeGreaterThan(0.2);
      expect(s.y).toBeLessThan(GOALKEEPER_SLOT.y);
    }
    // Cuatro en línea siguen dentro de 0,2..0,8.
    expect(formationSlots('4-2').slice(0, 4).map((s) => s.x)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(formationSlots('6').map((s) => s.y)).toEqual([0.46, 0.46, 0.46, 0.46, 0.46, 0.46]);
  });

  it('applyFormation respeta al portero y mantiene a cada jugador cerca de su fila actual', () => {
    const ev = new EventFactory();
    // Alineación 2-3-1 con 'lucas' de portero.
    const lineup = ev.lineup(T0, STARTERS, 'lucas');
    const state = reduceMatch(f7Config(), [lineup]);
    const entries = applyFormation(state, '3-2-1');

    expect(entries).toHaveLength(7);
    expect(entries[0]).toEqual({ playerId: 'lucas', position: GOALKEEPER_SLOT, goalkeeper: true });
    const outfield = entries.slice(1);
    expect(outfield.map((e) => e.position)).toEqual(formationSlots('3-2-1'));
    // Sin portero se reparten los que haya y sobran los últimos.
    const fewer = reduceMatch(f7Config(), [ev.lineup(T0, STARTERS.slice(0, 3).map((id) => id))]);
    expect(applyFormation(fewer, '2-1')).toHaveLength(3);
    expect(applyFormation(fewer, '1').at(-1)?.position).toEqual(fewer.players[STARTERS[2] ?? '']?.position);
  });

  it('changedPositions deja fuera a quien ya está en su hueco', () => {
    const ev = new EventFactory();
    const initial = reduceMatch(f7Config(), [ev.lineup(T0, STARTERS, 'lucas')]);
    const entries = applyFormation(initial, '2-3-1');
    // El helper coloca a los siete en una sola fila: todos cambian (el portero también, a su área).
    const changed = changedPositions(initial, entries);
    expect(changed).toHaveLength(7);

    // Con el campo ya colocado en 2-3-1, volver a aplicarlo no mueve a nadie.
    const placed = reduceMatch(f7Config(), [{ ...ev.lineup(T0, STARTERS, 'lucas'), metadata: { field: entries, bench: [] } }]);
    expect(changedPositions(placed, applyFormation(placed, '2-3-1'))).toEqual([]);
    expect(placed.players.lucas?.position).toEqual(GOALKEEPER_SLOT);
    expect(pos(0).y).toBe(0.5);
  });
});
