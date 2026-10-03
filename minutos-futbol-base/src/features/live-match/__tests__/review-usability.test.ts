import type { FieldPosition } from '../../../core';
import { DARK, LIGHT } from '../../../ui/theme';
import { DEMO_LINEUP } from '../createDemoSession';
import { GOALKEEPER_SLOT, formationSlots, formationsFor } from '../formations';
import {
  FULL_TOKEN_PITCH_HEIGHT,
  MIN_TOKEN_SCALE,
  TOKEN_COLUMN_HEIGHT,
  fieldTokenCenter,
  fieldTokenMetrics,
  fitPitch,
  tokenMetrics,
  type Size,
  type TokenMetrics,
} from '../geometry';

/**
 * Revisión de usabilidad (de pie, con una mano, al sol). Son cálculos puros
 * sobre geometry.ts, formations.ts y theme.ts: ninguna ficha debe pisar el
 * círculo de otra (texto de una encima del dorsal de otra) en los huecos que
 * deja de verdad un móvil, con cualquier dibujo de F7.
 */

/** Rectángulo de la columna de una ficha (círculo + pastilla del nombre) y de su círculo. */
function tokenRects(center: { x: number; y: number }, m: TokenMetrics) {
  const column = {
    left: center.x - m.columnWidth / 2,
    right: center.x + m.columnWidth / 2,
    top: center.y - m.radius,
    bottom: center.y - m.radius + m.columnHeight,
  };
  const circle = { left: center.x - m.radius, right: center.x + m.radius, top: center.y - m.radius, bottom: center.y + m.radius };
  return { column, circle };
}

type Box = { left: number; right: number; top: number; bottom: number };
const overlapPx = (a: Box, b: Box) => ({
  x: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
  y: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
});

/** Columnas que pisan el círculo de OTRA ficha, con las medidas que el campo usa para ese tamaño. */
function columnOverlaps(positions: readonly FieldPosition[], pitch: Size) {
  const m = fieldTokenMetrics(pitch);
  const centers = positions.map((position, i) => ({ id: i, c: fieldTokenCenter(position, pitch, m) }));
  const found: string[] = [];
  for (const a of centers) {
    for (const b of centers) {
      if (a.id === b.id) continue;
      const o = overlapPx(tokenRects(a.c, m).column, tokenRects(b.c, m).circle);
      if (o.x > 0 && o.y > 0) found.push(`${a.id} pisa ${b.id} (${Math.round(o.x)}×${Math.round(o.y)} px)`);
    }
  }
  return found;
}

const DEMO_POSITIONS = DEMO_LINEUP.map((e) => e.position);
const preset = (formation: string): FieldPosition[] => [GOALKEEPER_SLOT, ...formationSlots(formation)];
const F7_LINEUPS = [DEMO_POSITIONS, ...formationsFor(7).map(preset)];
const clean = (pitch: Size) => F7_LINEUPS.every((lineup) => columnOverlaps(lineup, pitch).length === 0);

describe('Revisión usabilidad: el campo en un móvil de 390 de ancho', () => {
  // Huecos medidos en el navegador (Chromium, isMobile): con el reloj de 46 px y
  // el banquillo compacto, a 390×700 (visor de la app de Claude) el campo sale
  // de 366×416; a 390×844 lo limita el ancho: 366×538.
  const VIEWER_PITCH = { width: 366, height: 416 };
  const PHONE_PITCH = { width: 366, height: 538 };

  it('llena el hueco si su proporción está entre 0,68 y 0,9; si no, se acota (campo real con alto de sobra, ancho con poco alto)', () => {
    expect(fitPitch(VIEWER_PITCH)).toEqual(VIEWER_PITCH);
    expect(fitPitch({ width: 366, height: 560 })).toEqual(PHONE_PITCH);
    expect(fitPitch({ width: 776, height: 937 })).toEqual({ width: 776, height: 937 });
    // Hueco muy alto → proporción real 0,68; hueco muy bajo → como mucho 0,9.
    expect(fitPitch({ width: 300, height: 2000 })).toEqual({ width: 300, height: 441 });
    expect(fitPitch({ width: 1000, height: 400 })).toEqual({ width: 360, height: 400 });
    expect(fitPitch({ width: 0, height: 400 })).toEqual({ width: 0, height: 0 });
  });

  it('la ficha de referencia (64 dp, columna de 84) vale desde 490 dp de alto de campo; por debajo se encoge, nunca por debajo de 46 dp (tocable)', () => {
    expect(TOKEN_COLUMN_HEIGHT).toBe(84);
    expect(fieldTokenMetrics(PHONE_PITCH)).toMatchObject({ scale: 1, size: 64, columnWidth: 84, columnHeight: 84 });
    expect(fieldTokenMetrics({ width: 776, height: 937 }).scale).toBe(1);
    // Visor de la app: 416/490 → círculo de 54 dp, columna de 71.
    expect(fieldTokenMetrics(VIEWER_PITCH)).toMatchObject({ size: 54, columnHeight: 71 });
    expect(fieldTokenMetrics({ width: 248, height: 276 })).toMatchObject({ scale: MIN_TOKEN_SCALE, size: 46 });
    expect(tokenMetrics(MIN_TOKEN_SCALE).size).toBeGreaterThanOrEqual(44);
    expect(tokenMetrics(5)).toEqual(tokenMetrics(1));
  });

  it('la alineación de demo y los seis dibujos de F7 quedan limpios en el visor (416), con el menú ⋯ abierto (−64) y en el móvil con dos filas de banquillo (538 − 90)', () => {
    for (const height of [416, 416 - 64, 538, 538 - 90, 538 - 120]) {
      const pitch = fitPitch({ width: 366, height });
      for (const lineup of F7_LINEUPS) expect(columnOverlaps(lineup, pitch)).toEqual([]);
    }
  });

  it('con cualquier proporción (0,68 o 0,9) no hay pisadas desde ~350 dp de alto, donde la ficha toca su mínimo', () => {
    let worst = 0;
    for (const aspect of [0.68, 0.9]) {
      for (let height = 250; height <= 1200; height++) {
        if (!clean({ width: Math.round(height * aspect), height })) worst = Math.max(worst, height);
      }
    }
    expect(worst).toBeLessThan(Math.round(FULL_TOKEN_PITCH_HEIGHT * MIN_TOKEN_SCALE));
    expect(worst).toBeGreaterThan(300);
  });

  it('límite conocido: por debajo del mínimo (visor a 390×600 con dos filas de banquillo) el portero roza a los defensas', () => {
    expect(columnOverlaps(preset('2-3-1'), fitPitch({ width: 366, height: 300 })).length).toBeGreaterThan(0);
  });
});

/** Contraste WCAG 2.x (relación de luminancias). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('Revisión usabilidad: contraste de la ficha sobre el césped', () => {
  // La ficha ya no apoya ningún texto directamente sobre el césped: el nombre va
  // en una pastilla `surface` y el tiempo dentro del círculo, sobre `accent`
  // (o `amber` en el portero). El % no se pinta en P8.
  it('el texto del tema no llega a AA sobre el césped (por eso no se pinta encima)', () => {
    expect(contrast(LIGHT.colors.text, LIGHT.colors.grass)).toBeLessThan(4.5);
    expect(contrast(LIGHT.colors.textMuted, LIGHT.colors.grass)).toBeLessThan(4.5);
  });

  it('nombre (sobre surface) y tiempo (sobre el relleno) cumplen AA 4,5:1 en claro y oscuro', () => {
    for (const t of [LIGHT, DARK]) {
      expect(contrast(t.colors.text, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.colors.onAccent, t.colors.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.colors.onAmber, t.colors.amber)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.colors.textMuted, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el halo (grassLine) separa la ficha del césped con ≥ 3:1 (WCAG 1.4.11), cosa que el azul solo no hace', () => {
    for (const t of [LIGHT, DARK]) {
      expect(contrast(t.colors.accent, t.colors.grass)).toBeLessThan(3);
      expect(contrast(t.colors.grassLine, t.colors.grass)).toBeGreaterThanOrEqual(3);
    }
  });

  it('el banquillo iluminado deja legible la ficha encima (accent sobre benchHighlight ≥ 3:1)', () => {
    for (const t of [LIGHT, DARK]) {
      expect(contrast(t.colors.accent, t.colors.benchHighlight)).toBeGreaterThanOrEqual(3);
      // Y el tinte es más visible que el anterior (1,22 / 1,45) sobre el fondo normal.
      expect(contrast(t.colors.benchHighlight, t.colors.surface)).toBeGreaterThanOrEqual(1.8);
    }
  });
});
