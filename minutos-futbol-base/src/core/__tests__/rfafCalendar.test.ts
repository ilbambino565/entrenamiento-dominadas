import { parseRfafCalendar } from '../rfafCalendar';

/**
 * Calendarios inventados con la misma forma que la página de la RFAF: clubes en
 * mayúsculas, campo en minúsculas, goles opcionales y nombres partidos en
 * varias líneas. Ningún club ni campo real.
 */
const OWN = 'C.D. EJEMPLO "A"';
const ms = (d: number, m: number, y: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

const HEADER = `Calendario

3ª Liga Inventada Benjamín (Provincia), Grupo 9
Temporada 2030-2031
Ver Clasificación`;

const ONE_LINE = `${HEADER}

Jornada 1 (20-09-2030)
C.D. EJEMPLO "A" 8 – 2 PEÑA IMAGINARIA Ciudad - La Fuensanta Campo Municipal (F11-F7) (A) 18-09-2030 - 18:45
UD NORTE 1 – 8 ATLETICO SUR "B" Ciudad - El Duende Campo Municipal (F11-F7) (A) 19-09-2030 - 10:10
CLUB OTRO 3 – 1 C.D. EJEMPLO "A" Otra - Luís Teruel Campo Municipal (F11,F7) (A) 19-09-2030 - 12:00

Jornada 2 (27-09-2030)
UD NORTE – C.D. EJEMPLO "A" Ciudad - Campo Norte (F11-F7) (A) 25-09-2030 - 17:00
C.D. EJEMPLO "A" – ATLETICO SUR "B" Ciudad - Roma Luz Campo Municipal (F11-F7) (A) 10-10-2030

Jornada 3 (04-10-2030)
C.D. EJEMPLO "A" 2 – 12 CLUB OTRO Ciudad - Pedro Campo (F11-F7) (A) 02-10-2030 - 18:00
`;

/** Lo que pegaría una página con los nombres largos y el campo partidos en varias líneas. */
const WRAPPED = `${HEADER}

Jornada 1 (20-09-2030)

C.D. EJEMPLO
"A" 8  2 PEÑA
IMAGINARIA
Ciudad - La Fuensanta Campo Municipal (F11-
F7) (A)
18-09-2030 - 18:45

CLUB OTRO
INVENTADO "B" 3  1 C.D. EJEMPLO
"A"
Otra - Luís Teruel Campo
Municipal (F11,F7) (A)
19-09-2030 - 12:00
`;

describe('parseRfafCalendar', () => {
  it('lee competición y temporada de la cabecera', () => {
    const calendar = parseRfafCalendar(ONE_LINE, OWN);
    expect(calendar.competition).toBe('3ª Liga Inventada Benjamín (Provincia), Grupo 9');
    expect(calendar.season).toBe('2030-2031');
  });

  it('devuelve solo los partidos del equipo, en casa o fuera, con goles, campo, fecha y hora', () => {
    const { fixtures } = parseRfafCalendar(ONE_LINE, OWN);
    expect(fixtures).toEqual([
      {
        matchday: 1,
        matchdayDate: ms(20, 9, 2030),
        opponent: 'PEÑA IMAGINARIA',
        homeAway: 'HOME',
        venue: 'Ciudad - La Fuensanta Campo Municipal (F11-F7) (A)',
        scheduledAt: ms(18, 9, 2030, 18, 45),
        hasTime: true,
      },
      {
        matchday: 1,
        matchdayDate: ms(20, 9, 2030),
        opponent: 'CLUB OTRO',
        homeAway: 'AWAY',
        venue: 'Otra - Luís Teruel Campo Municipal (F11,F7) (A)',
        scheduledAt: ms(19, 9, 2030, 12, 0),
        hasTime: true,
      },
      {
        matchday: 2,
        matchdayDate: ms(27, 9, 2030),
        opponent: 'UD NORTE',
        homeAway: 'AWAY',
        venue: 'Ciudad - Campo Norte (F11-F7) (A)',
        scheduledAt: ms(25, 9, 2030, 17, 0),
        hasTime: true,
      },
      {
        matchday: 2,
        matchdayDate: ms(27, 9, 2030),
        opponent: 'ATLETICO SUR "B"',
        homeAway: 'HOME',
        venue: 'Ciudad - Roma Luz Campo Municipal (F11-F7) (A)',
        scheduledAt: ms(10, 10, 2030),
        hasTime: false,
      },
      {
        matchday: 3,
        matchdayDate: ms(4, 10, 2030),
        opponent: 'CLUB OTRO',
        homeAway: 'HOME',
        venue: 'Ciudad - Pedro Campo (F11-F7) (A)',
        scheduledAt: ms(2, 10, 2030, 18, 0),
        hasTime: true,
      },
    ]);
  });

  it('con los nombres y el campo partidos en varias líneas da el mismo resultado', () => {
    const { fixtures } = parseRfafCalendar(WRAPPED, OWN);
    expect(fixtures.map((f) => [f.matchday, f.opponent, f.homeAway])).toEqual([
      [1, 'PEÑA IMAGINARIA', 'HOME'],
      [1, 'CLUB OTRO INVENTADO "B"', 'AWAY'],
    ]);
    expect(fixtures[0]?.venue).toBe('Ciudad - La Fuensanta Campo Municipal (F11- F7) (A)');
  });

  it('encuentra el equipo sin importar tildes, mayúsculas, comillas tipográficas ni espacios', () => {
    const text = ONE_LINE.replace('C.D. EJEMPLO "A" 8', 'C.D.   Ejemplo “A” 8');
    expect(parseRfafCalendar(text, 'c.d. ejemplo "A"').fixtures).toHaveLength(5);
    expect(parseRfafCalendar(ONE_LINE, 'C.D. EJEMPLO “A”').fixtures).toHaveLength(5);
  });

  it('no confunde un club de otra letra ("B") ni uno cuyo nombre contiene el nuestro pegado a otra palabra', () => {
    const text = `Jornada 1 (20-09-2030)
C.D. EJEMPLO "B" 1 – 0 UD NORTE Ciudad - Campo (A) 20-09-2030 - 10:00
XC.D. EJEMPLO "A" 2 – 0 UD NORTE Ciudad - Campo (A) 20-09-2030 - 11:00
C.D. EJEMPLO "A" 3 – 0 UD NORTE Ciudad - Campo (A) 20-09-2030 - 12:00
`;
    const { fixtures } = parseRfafCalendar(text, OWN);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({ opponent: 'UD NORTE', scheduledAt: ms(20, 9, 2030, 12, 0) });
  });

  it('un rival escrito en minúsculas se separa del campo por el guion', () => {
    const text = `Jornada 1 (20-09-2030)
C.D. EJEMPLO "A" – Peña Imaginaria Ciudad - Campo Norte (A) 20-09-2030 - 10:00
`;
    expect(parseRfafCalendar(text, OWN).fixtures[0]).toMatchObject({ opponent: 'Peña Imaginaria', venue: 'Ciudad - Campo Norte (A)' });
  });

  it('descarta fechas imposibles y devuelve vacío sin el equipo, sin jornadas o con el equipo en blanco', () => {
    const impossible = `Jornada 1 (20-09-2030)
C.D. EJEMPLO "A" – UD NORTE Ciudad - Campo (A) 31-02-2030 - 10:00
`;
    expect(parseRfafCalendar(impossible, OWN).fixtures).toEqual([]);
    expect(parseRfafCalendar(ONE_LINE, 'OTRO EQUIPO').fixtures).toEqual([]);
    expect(parseRfafCalendar('nada de esto es un calendario', OWN)).toEqual({ competition: null, season: null, fixtures: [] });
    expect(parseRfafCalendar(ONE_LINE, '   ').fixtures).toEqual([]);
    expect(parseRfafCalendar('', OWN).fixtures).toEqual([]);
  });

  it('un nombre que acaba en cifra no se toma por goles y un solo gol con guion sí se descarta', () => {
    const text = `Jornada 1 (20-09-2030)
ATLETICO 2 – C.D. EJEMPLO "A" Ciudad - Campo (A) 20-09-2030 - 10:00
ATLETICO 2 5 – C.D. EJEMPLO "A" Ciudad - Campo (A) 21-09-2030 - 10:00
`;
    const [first, second] = parseRfafCalendar(text, OWN).fixtures;
    expect(first?.opponent).toBe('ATLETICO');
    expect(second?.opponent).toBe('ATLETICO 2');
  });

  it('una jornada sin fecha en la cabecera no la inventa y el resto sigue funcionando', () => {
    const text = `Jornada 1 (31-02-2030)
C.D. EJEMPLO "A" – UD NORTE Ciudad - Campo (A) 20-09-2030 - 10:00
`;
    expect(parseRfafCalendar(text, OWN).fixtures[0]).toMatchObject({ matchday: 1, matchdayDate: null, opponent: 'UD NORTE' });
  });
});
