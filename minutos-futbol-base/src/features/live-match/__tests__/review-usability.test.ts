import { DARK, LIGHT } from '../../../ui/theme';
import { DEMO_LINEUP } from '../createDemoSession';
import { TOKEN_COLUMN_HEIGHT, TOKEN_COLUMN_WIDTH, TOKEN_RADIUS, fieldTokenCenter, fitPitch } from '../geometry';

/**
 * Revisión de usabilidad (de pie, con una mano, al sol). Son cálculos puros
 * sobre geometry.ts y theme.ts. El único `it.failing` que queda documenta un
 * límite conocido (campo muy bajo) que solo se resuelve escalando la ficha.
 */

/** Rectángulo de la columna de una ficha (círculo + pastilla del nombre) y de su círculo. */
function tokenRects(center: { x: number; y: number }) {
  const column = {
    left: center.x - TOKEN_COLUMN_WIDTH / 2,
    right: center.x + TOKEN_COLUMN_WIDTH / 2,
    top: center.y - TOKEN_RADIUS,
    bottom: center.y - TOKEN_RADIUS + TOKEN_COLUMN_HEIGHT,
  };
  const circle = { left: center.x - TOKEN_RADIUS, right: center.x + TOKEN_RADIUS, top: center.y - TOKEN_RADIUS, bottom: center.y + TOKEN_RADIUS };
  return { column, circle };
}

type Box = { left: number; right: number; top: number; bottom: number };
const overlapPx = (a: Box, b: Box) => ({
  x: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
  y: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
});

/** Columnas que pisan el círculo de OTRA ficha (texto de una encima del dorsal de otra). */
function columnOverlaps(pitch: { width: number; height: number }) {
  const centers = DEMO_LINEUP.map((e) => ({ id: e.playerId, c: fieldTokenCenter(e.position, pitch) }));
  const found: string[] = [];
  for (const a of centers) {
    for (const b of centers) {
      if (a.id === b.id) continue;
      const o = overlapPx(tokenRects(a.c).column, tokenRects(b.c).circle);
      if (o.x > 0 && o.y > 0) found.push(`${a.id} pisa ${b.id} (${Math.round(o.x)}×${Math.round(o.y)} px)`);
    }
  }
  return found;
}

describe('Revisión usabilidad: el campo en un móvil de 390×844', () => {
  // Hueco que deja la pantalla: 844 − insets (47+34) − ClockBar (≈158: reloj 64 +
  // fila de botones 56 + rival 18 + márgenes) − banquillo de una fila (≈145) −
  // paddingVertical del área (16) = 444 de alto; 390 − 24 de ancho. Con la
  // columna de 84 dp el banquillo es ~20 dp más bajo, así que es el caso peor.
  const PHONE_AREA = { width: 366, height: 444 };

  it('cabe en el hueco con la proporción fija: 302×444 (en tablet 800×1280 sale 637×937)', () => {
    expect(fitPitch(PHONE_AREA)).toEqual({ width: 302, height: 444 });
    expect(fitPitch({ width: 776, height: 937 })).toEqual({ width: 637, height: 937 });
    expect(columnOverlaps(fitPitch({ width: 776, height: 937 }))).toEqual([]);
  });

  it('la columna de la ficha mide 84 dp: ninguna pisa el círculo de otra con la alineación de demo en el móvil', () => {
    // Las filas 0,22 / 0,45 / 0,68 distan 0,23 × 444 = 102 dp: con 118 dp de
    // columna el % de Pablo caía sobre el dorsal de Mateo y el portero (acotado
    // para que su columna quepa) chocaba con Daniel y Leo. Con 84 dp no.
    expect(TOKEN_COLUMN_HEIGHT).toBe(84);
    expect(columnOverlaps(fitPitch(PHONE_AREA))).toEqual([]);
  });

  it('las filas de la demo dejan de pisarse a partir de 425 dp de alto de campo, por debajo del hueco del móvil (444)', () => {
    let minHeight = 0;
    for (let h = 200; h <= 1200 && minHeight === 0; h++) {
      if (columnOverlaps(fitPitch({ width: 10_000, height: h })).length === 0) minHeight = h;
    }
    expect(minHeight).toBe(425);
    expect(minHeight).toBeLessThanOrEqual(PHONE_AREA.height);
  });

  it.failing('límite conocido: con el menú ⋯ abierto (ClockBar +64) o con 7 suplentes (2 filas, +113) el portero sigue chocando con los defensas', () => {
    // Solo se resuelve escalando TOKEN_SIZE con el campo (afecta al imán): fuera de esta entrega.
    expect(columnOverlaps(fitPitch({ width: 366, height: 444 - 64 }))).toEqual([]);
    expect(columnOverlaps(fitPitch({ width: 366, height: 444 - 113 }))).toEqual([]);
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
