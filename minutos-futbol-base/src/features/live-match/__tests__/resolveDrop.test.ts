import { createInitialState, reduceMatch, type MatchState } from '../../../core';
import { EventFactory, T0 } from '../../../core/__tests__/helpers';
import { DEMO_BENCH, DEMO_CONFIG, DEMO_LINEUP } from '../createDemoSession';
import { TOKEN_RADIUS, fieldTokenCenter } from '../geometry';
import {
  DEAD_ZONE,
  fieldTokenLayouts,
  locateTarget,
  resolveDrop,
  resolveTarget,
  type DropLayout,
  type DropOrigin,
} from '../resolveDrop';

/**
 * Tabla de casos de la función pura (docs/04 §4.4). Geometría: campo de
 * 340×500 en (10, 100) y banquillo de 340×130 justo debajo (10, 612).
 */
const PITCH = { x: 10, y: 100, width: 340, height: 500 };
const BENCH = { x: 10, y: 612, width: 340, height: 130 };

function lineupState(): MatchState {
  const ev = new EventFactory('demo');
  return reduceMatch(DEMO_CONFIG, [
    ev.make('LINEUP_SET', T0, { metadata: { field: [...DEMO_LINEUP], bench: [...DEMO_BENCH] } }),
  ]);
}

function layoutFor(state: MatchState, overrides: Partial<DropLayout> = {}): DropLayout {
  return { pitch: PITCH, bench: BENCH, tokens: fieldTokenLayouts(state, PITCH), ...overrides };
}

/** Centro absoluto de la ficha de un jugador del campo. */
function centerOf(state: MatchState, playerId: string) {
  const p = state.players[playerId];
  if (!p?.position) throw new Error(`${playerId} no está en el campo`);
  const local = fieldTokenCenter(p.position, PITCH);
  return { x: PITCH.x + local.x, y: PITCH.y + local.y };
}

const HUGO: DropOrigin = { playerId: 'hugo', from: 'BENCH' };
const LUCAS: DropOrigin = { playerId: 'lucas', from: 'FIELD' };

describe('resolveDrop', () => {
  const state = lineupState();
  const layout = layoutFor(state);

  it('imán: banquillo → ficha del campo = sustitución (dentro de 0,6 × diámetro)', () => {
    const c = centerOf(state, 'lucas');
    const near = { x: c.x + 0.6 * 2 * TOKEN_RADIUS - 1, y: c.y };
    expect(resolveDrop({ origin: HUGO, point: near, layout, state })).toEqual({ kind: 'substitute', inId: 'hugo', outId: 'lucas' });
  });

  it('imán: campo → otra ficha del campo = intercambio', () => {
    const c = centerOf(state, 'mateo');
    expect(resolveDrop({ origin: LUCAS, point: c, layout, state })).toEqual({ kind: 'swap', a: 'lucas', b: 'mateo' });
  });

  it('imán: con dos fichas cerca gana la más próxima', () => {
    const a = { x: 200, y: 300 };
    const close = layoutFor(state, {
      tokens: [
        { playerId: 'daniel', center: a, radius: TOKEN_RADIUS },
        { playerId: 'leo', center: { x: a.x + 30, y: a.y }, radius: TOKEN_RADIUS },
      ],
    });
    expect(resolveDrop({ origin: HUGO, point: { x: a.x + 20, y: a.y }, layout: close, state })).toMatchObject({ kind: 'substitute', outId: 'leo' });
    expect(resolveDrop({ origin: HUGO, point: { x: a.x + 10, y: a.y }, layout: close, state })).toMatchObject({ kind: 'substitute', outId: 'daniel' });
  });

  it('fuera del radio del imán en zona libre: banquillo → entra con posición acotada', () => {
    // Campo con hueco: Lucas al banquillo.
    const ev = new EventFactory('demo');
    const withGap = reduceMatch(DEMO_CONFIG, [
      ev.make('LINEUP_SET', T0, { metadata: { field: DEMO_LINEUP.filter((e) => e.playerId !== 'lucas'), bench: ['lucas', ...DEMO_BENCH] } }),
    ]);
    const l = layoutFor(withGap);
    // Esquina superior izquierda, justo pasada la franja muerta → se acota a 0.04.
    const corner = { x: PITCH.x + DEAD_ZONE + 1, y: PITCH.y + DEAD_ZONE + 1 };
    expect(resolveDrop({ origin: HUGO, point: corner, layout: l, state: withGap })).toEqual({
      kind: 'enter',
      playerId: 'hugo',
      position: { x: 0.04, y: 0.04 },
    });
    // Punto medio libre (entre Pablo y los medios no hay ficha a menos de 38 px).
    const mid = { x: PITCH.x + PITCH.width * 0.2, y: PITCH.y + PITCH.height * 0.3 };
    const action = resolveDrop({ origin: HUGO, point: mid, layout: l, state: withGap });
    expect(action.kind).toBe('enter');
    if (action.kind === 'enter') {
      expect(action.position.x).toBeCloseTo(0.2, 5);
      expect(action.position.y).toBeCloseTo(0.3, 5);
    }
  });

  it('fuera del radio del imán en zona libre: campo → mover', () => {
    const mid = { x: PITCH.x + PITCH.width * 0.8, y: PITCH.y + PITCH.height * 0.8 };
    expect(resolveDrop({ origin: LUCAS, point: mid, layout, state })).toMatchObject({ kind: 'move', playerId: 'lucas' });
  });

  it('campo lleno al soltar en zona libre → rejected FIELD_FULL', () => {
    const mid = { x: PITCH.x + PITCH.width * 0.8, y: PITCH.y + PITCH.height * 0.8 };
    expect(resolveDrop({ origin: HUGO, point: mid, layout, state })).toEqual({ kind: 'rejected', reason: 'FIELD_FULL' });
  });

  it('banquillo: campo → sale; banquillo → reordenar (sin efecto)', () => {
    const inBench = { x: BENCH.x + 100, y: BENCH.y + 60 };
    expect(resolveDrop({ origin: LUCAS, point: inBench, layout, state })).toEqual({ kind: 'leave', playerId: 'lucas' });
    expect(resolveDrop({ origin: HUGO, point: inBench, layout, state })).toEqual({ kind: 'reorder-bench' });
  });

  it('franja muerta de 12 dp entre campo y banquillo → cancelar', () => {
    const bottomEdge = { x: PITCH.x + PITCH.width * 0.1, y: PITCH.y + PITCH.height - DEAD_ZONE + 1 };
    expect(resolveDrop({ origin: HUGO, point: bottomEdge, layout, state })).toEqual({ kind: 'cancel' });
    const benchTop = { x: BENCH.x + 100, y: BENCH.y + DEAD_ZONE - 1 };
    expect(resolveDrop({ origin: LUCAS, point: benchTop, layout, state })).toEqual({ kind: 'cancel' });
    const between = { x: BENCH.x + 100, y: (PITCH.y + PITCH.height + BENCH.y) / 2 };
    expect(resolveDrop({ origin: LUCAS, point: between, layout, state })).toEqual({ kind: 'cancel' });
  });

  it('fuera de todas las zonas → cancelar; sin medidas → cancelar', () => {
    expect(resolveDrop({ origin: HUGO, point: { x: 0, y: 0 }, layout, state })).toEqual({ kind: 'cancel' });
    expect(resolveDrop({ origin: HUGO, point: { x: 100, y: 300 }, layout: { pitch: null, bench: null, tokens: [] }, state })).toEqual({
      kind: 'cancel',
    });
  });

  it.each([
    [10, 0],
    [20, 20],
    [30, 0],
    [37, 0],
    [39, 0],
  ])('el imán ignora la propia ficha: recolocar un titular %i,%i px desde su centro es "move"', (dx, dy) => {
    // Su centro sigue en el sitio de origen: sin excluirla, cualquier arrastre
    // corto (< 38 px) se la "tragaba" como SAME_PLAYER sin evento ni aviso.
    const c = centerOf(state, 'lucas');
    const action = resolveDrop({ origin: LUCAS, point: { x: c.x + dx, y: c.y + dy }, layout, state });
    expect(action).toMatchObject({ kind: 'move', playerId: 'lucas' });
  });

  it('la propia ficha sigue siendo imán para las demás (otra ficha a la misma distancia gana)', () => {
    const c = centerOf(state, 'lucas');
    const close = layoutFor(state, {
      tokens: [
        { playerId: 'lucas', center: c, radius: TOKEN_RADIUS },
        { playerId: 'mateo', center: { x: c.x + 30, y: c.y }, radius: TOKEN_RADIUS },
      ],
    });
    expect(resolveDrop({ origin: LUCAS, point: { x: c.x + 5, y: c.y }, layout: close, state })).toEqual({ kind: 'swap', a: 'lucas', b: 'mateo' });
    expect(resolveDrop({ origin: HUGO, point: { x: c.x + 5, y: c.y }, layout: close, state })).toEqual({ kind: 'substitute', inId: 'hugo', outId: 'lucas' });
  });

  it('por toques, tocar la ficha ya seleccionada sigue siendo SAME_PLAYER (lo gestiona tapToken)', () => {
    expect(resolveTarget(LUCAS, { kind: 'token', playerId: 'lucas' }, state)).toEqual({ kind: 'rejected', reason: 'SAME_PLAYER' });
  });

  it('antes del pitido las mismas acciones editan la alineación (sin estado especial)', () => {
    const draft = createInitialState(DEMO_CONFIG);
    const mid = { x: PITCH.x + PITCH.width * 0.5, y: PITCH.y + PITCH.height * 0.5 };
    expect(resolveDrop({ origin: HUGO, point: mid, layout: layoutFor(draft), state: draft })).toMatchObject({ kind: 'enter' });
  });
});

describe('locateTarget / resolveTarget (selección por toques)', () => {
  const state = lineupState();

  it('localiza ficha, campo, banquillo y nada', () => {
    const layout = layoutFor(state);
    expect(locateTarget(centerOf(state, 'pablo'), layout)).toEqual({ kind: 'token', playerId: 'pablo' });
    expect(locateTarget({ x: PITCH.x + 50, y: PITCH.y + 300 }, layout)).toMatchObject({ kind: 'pitch' });
    expect(locateTarget({ x: BENCH.x + 50, y: BENCH.y + 50 }, layout)).toEqual({ kind: 'bench' });
    expect(locateTarget({ x: 0, y: 0 }, layout)).toEqual({ kind: 'none' });
  });

  it('tocar una ficha del banquillo con un jugador del campo seleccionado = sale', () => {
    expect(resolveTarget(LUCAS, { kind: 'token', playerId: 'hugo' }, state)).toEqual({ kind: 'leave', playerId: 'lucas' });
    expect(resolveTarget(HUGO, { kind: 'token', playerId: 'adrian' }, state)).toEqual({ kind: 'reorder-bench' });
  });

  it('un jugador desconocido como destino se ignora', () => {
    expect(resolveTarget(HUGO, { kind: 'token', playerId: 'nadie' }, state)).toEqual({ kind: 'cancel' });
  });
});
