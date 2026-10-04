import {
  defaultMatchSetup,
  formatDateText,
  formatShortDate,
  formatTimeText,
  normalizeMatchSetup,
  parseDateTime,
  parseMinutes,
  validateMatchSetup,
  type MatchSetupDraft,
} from '../matchSetup';

const NOW = new Date(2026, 9, 4, 10, 30).getTime();
const team = { periodsCount: 2, periodDurationMs: 25 * 60_000 };
const valid = (patch: Partial<MatchSetupDraft> = {}): MatchSetupDraft => ({ ...defaultMatchSetup(team, NOW), opponent: 'CD Rival', ...patch });
const fields = (draft: MatchSetupDraft) => validateMatchSetup(draft).map((i) => i.field);

describe('matchSetup: fecha y hora', () => {
  it('formatea en hora local y vuelve a leer lo mismo', () => {
    expect(formatDateText(NOW)).toBe('04/10/2026');
    expect(formatTimeText(NOW)).toBe('10:30');
    expect(parseDateTime(formatDateText(NOW), formatTimeText(NOW))).toBe(NOW);
  });

  it('la fecha corta lleva el día de la semana en español', () => {
    expect(formatShortDate(NOW)).toBe('dom 04/10');
    expect(formatShortDate(new Date(2026, 8, 27, 10, 0).getTime())).toBe('dom 27/09');
    expect(formatShortDate(new Date(2026, 8, 26, 10, 0).getTime())).toBe('sáb 26/09');
  });

  it('acepta separadores alternativos, días sin cero y espacios', () => {
    expect(parseDateTime(' 4-10-2026 ', '10.30')).toBe(NOW);
    expect(parseDateTime('04.10.2026', '9:05')).toBe(new Date(2026, 9, 4, 9, 5).getTime());
  });

  it('rechaza formatos raros y fechas u horas que no existen en vez de corregirlas', () => {
    for (const [date, time] of [
      ['', '10:30'],
      ['04/10/26', '10:30'],
      ['31/02/2026', '10:30'],
      ['00/10/2026', '10:30'],
      ['04/13/2026', '10:30'],
      ['04/10/2026', '25:00'],
      ['04/10/2026', '10:60'],
      ['04/10/2026', ''],
      ['cuatro', 'diez'],
    ] as const) {
      expect(parseDateTime(date, time)).toBeNull();
    }
  });

  it('acepta el 29 de febrero solo en año bisiesto', () => {
    expect(parseDateTime('29/02/2028', '12:00')).not.toBeNull();
    expect(parseDateTime('29/02/2027', '12:00')).toBeNull();
  });
});

describe('matchSetup: minutos', () => {
  it('acepta enteros de 1 a 90 y rechaza el resto', () => {
    expect(parseMinutes('25')).toBe(25);
    expect(parseMinutes(' 1 ')).toBe(1);
    expect(parseMinutes('90')).toBe(90);
    for (const text of ['', '0', '91', '12.5', '-3', 'abc', '1e1']) expect(parseMinutes(text)).toBeNull();
  });
});

describe('matchSetup: valores por defecto y validación', () => {
  it('propone los del equipo, la fecha de ahora y el rival vacío', () => {
    expect(defaultMatchSetup({ periodsCount: 4, periodDurationMs: 12 * 60_000 }, NOW)).toEqual({
      opponent: '',
      scheduledAt: NOW,
      periodsCount: 4,
      periodMinutes: 12,
      homeAway: null,
      competition: '',
      matchday: '',
    });
  });

  it('un borrador completo es válido y el rival es lo único que falta al principio', () => {
    expect(validateMatchSetup(valid())).toEqual([]);
    expect(fields(defaultMatchSetup(team, NOW))).toEqual(['opponent']);
    expect(fields(valid({ opponent: '   ' }))).toEqual(['opponent']);
  });

  it('señala todos los problemas a la vez', () => {
    const issues = fields({
      opponent: 'x'.repeat(61),
      scheduledAt: null,
      periodsCount: 5,
      periodMinutes: null,
      homeAway: null,
      competition: 'c'.repeat(61),
      matchday: 'j'.repeat(31),
    });
    expect(issues).toEqual(['opponent', 'scheduledAt', 'periodsCount', 'periodMinutes', 'competition', 'matchday']);
  });

  it('normalizar recorta rival, competición y jornada y no toca el resto', () => {
    const draft = valid({ opponent: '  CD Rival ', competition: ' Liga ', matchday: ' J3 ', homeAway: 'HOME' });
    expect(normalizeMatchSetup(draft)).toEqual({ ...draft, opponent: 'CD Rival', competition: 'Liga', matchday: 'J3' });
  });
});
