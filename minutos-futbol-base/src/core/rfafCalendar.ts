import type { HomeAway } from './match';

/**
 * Lector del calendario de la RFAF pegado como texto (docs/08, import de
 * calendario). NO descarga nada: recibe el texto que el entrenador copia de la
 * web (la web prohíbe a los programas leerla, robots.txt) y devuelve los
 * partidos del equipo indicado. Dominio puro, sin red.
 *
 * Formato de la página, por jornada:
 *   Jornada 3 (04-10-2026)
 *   <LOCAL> <goles> – <goles> <VISITANTE> <Localidad - Campo … (A)> <dd-mm-aaaa> [- hh:mm]
 * con los nombres de club en MAYÚSCULAS y el campo en minúsculas/mixto. Los
 * nombres largos y el campo se parten en varias líneas según el ancho, así que
 * se aplana el texto y se ancla el partido en el nombre del equipo propio: lo
 * que queda a un lado es el rival (y, si va delante, el equipo es visitante).
 * Los goles son opcionales ("–" a secas = sin jugar).
 */
export interface RfafFixture {
  matchday: number;
  /** Fecha de la jornada (epoch ms, 00:00 local), o null si no aparece. */
  matchdayDate: number | null;
  opponent: string;
  homeAway: HomeAway;
  ownScore: number | null;
  opponentScore: number | null;
  venue: string | null;
  /** Fecha del partido en hora local; sin hora en la página es las 00:00 y `hasTime` es false. */
  scheduledAt: number;
  hasTime: boolean;
}

export interface RfafCalendar {
  competition: string | null;
  season: string | null;
  fixtures: RfafFixture[];
}

/** Un carácter → un carácter: sin tildes, mayúsculas y comillas rectas, para poder buscar sin descuadrar posiciones. */
function fold(text: string): string {
  let out = '';
  for (const char of text) {
    const base = char.normalize('NFD')[0] ?? char;
    out += base === '“' || base === '”' || base === '«' || base === '»' ? '"' : base === '’' || base === '‘' ? "'" : base.toUpperCase();
  }
  return out;
}

const flatten = (text: string): string => text.replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();

const JORNADA = /Jornada\s+(\d+)\s*\((\d{2})-(\d{2})-(\d{4})\)/gi;
const DATE_TIME = /(\d{2})-(\d{2})-(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2}))?/g;
const DASH = /^[–—-]$/;

const localMs = (y: number, m: number, d: number, hh = 0, mm = 0): number | null => {
  const date = new Date(y, m - 1, d, hh, mm);
  const exact = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && date.getHours() === hh && date.getMinutes() === mm;
  return exact ? date.getTime() : null;
};

/**
 * `HOME 3 – 1` → nombre y goles. El guion puede perderse al copiar ("3  1"), y
 * una sola cifra solo cuenta como gol si va con guion ("HOME 3 –"): sin él
 * ("ATLETICO 2") es parte del nombre.
 */
function splitScoreTail(text: string): { name: string; first: number | null; second: number | null } {
  const t = text.trim();
  const both = /^(.*?)\s+(\d+)\s*[–—-]?\s*(\d+)$/.exec(t);
  if (both) return { name: (both[1] ?? '').trim(), first: Number(both[2]), second: Number(both[3]) };
  const dashed = /^(.*?)\s*(\d+)?\s*[–—-]\s*(\d+)?$/.exec(t);
  if (dashed) return { name: (dashed[1] ?? '').trim(), first: dashed[2] !== undefined ? Number(dashed[2]) : null, second: dashed[3] !== undefined ? Number(dashed[3]) : null };
  return { name: t, first: null, second: null };
}

/** `3 – 1 RIVAL … campo` → goles + resto (mismas reglas que `splitScoreTail`, por delante). */
function splitScoreHead(text: string): { first: number | null; second: number | null; rest: string } {
  const t = text.trim();
  const both = /^(\d+)\s*[–—-]?\s*(\d+)\s+(.*)$/.exec(t);
  if (both) return { first: Number(both[1]), second: Number(both[2]), rest: (both[3] ?? '').trim() };
  const dashed = /^(\d+)?\s*[–—-](?:\s*(\d+))?\s+(.*)$/.exec(t);
  if (dashed) return { first: dashed[1] !== undefined ? Number(dashed[1]) : null, second: dashed[2] !== undefined ? Number(dashed[2]) : null, rest: (dashed[3] ?? '').trim() };
  return { first: null, second: null, rest: t };
}

const hasLowercase = (token: string): boolean => /\p{Ll}/u.test(token);

/** Rival y campo cuando el equipo propio juega en casa: el nombre del club es la racha inicial de palabras en mayúsculas. */
function splitOpponentAndVenue(rest: string): { opponent: string; venue: string | null } {
  const tokens = rest.split(' ').filter(Boolean);
  let i = 0;
  while (i < tokens.length && !hasLowercase(tokens[i] ?? '') && !DASH.test(tokens[i] ?? '')) i++;
  if (i === 0) {
    // Un club escrito en minúsculas: el campo es "Localidad - Lugar", así que el rival termina antes de la palabra previa al guion.
    const dash = tokens.findIndex((t) => DASH.test(t));
    const cut = dash > 1 ? dash - 1 : tokens.length;
    return { opponent: tokens.slice(0, cut).join(' '), venue: tokens.slice(cut).join(' ') || null };
  }
  return { opponent: tokens.slice(0, i).join(' '), venue: tokens.slice(i).join(' ') || null };
}

function boundaryAt(folded: string, start: number, length: number): boolean {
  const before = folded[start - 1];
  const after = folded[start + length];
  const word = /[A-Z0-9"]/;
  return (before === undefined || !word.test(before)) && (after === undefined || !word.test(after));
}

function findOwn(folded: string, own: string): number {
  let from = 0;
  for (;;) {
    const at = folded.indexOf(own, from);
    if (at < 0) return -1;
    if (boundaryAt(folded, at, own.length)) return at;
    from = at + 1;
  }
}

function header(raw: string): { competition: string | null; season: string | null } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const seasonAt = lines.findIndex((l) => /^Temporada\s+\d{4}-\d{4}/i.test(l));
  if (seasonAt < 0) return { competition: null, season: null };
  const season = /\d{4}-\d{4}/.exec(lines[seasonAt] ?? '')?.[0] ?? null;
  const competition = lines.slice(0, seasonAt).reverse().find((l) => l !== '') ?? null;
  return { competition, season };
}

/**
 * Partidos de `ownTeam` en el texto pegado, por jornada. Sin el equipo en el
 * texto o sin jornadas devuelve la lista vacía (no lanza): la pantalla decide qué decir.
 */
export function parseRfafCalendar(text: string, ownTeam: string): RfafCalendar {
  const { competition, season } = header(text);
  const own = fold(flatten(ownTeam));
  const flat = flatten(text);
  const fixtures: RfafFixture[] = [];
  if (own === '') return { competition, season, fixtures };

  const headers = [...flat.matchAll(JORNADA)];
  headers.forEach((h, index) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = headers[index + 1]?.index ?? flat.length;
    const segment = flat.slice(start, end);
    const matchday = Number(h[1]);
    const matchdayDate = localMs(Number(h[4]), Number(h[3]), Number(h[2]));

    let chunkStart = 0;
    for (const terminator of segment.matchAll(DATE_TIME)) {
      const chunk = segment.slice(chunkStart, terminator.index ?? 0).trim();
      chunkStart = (terminator.index ?? 0) + terminator[0].length;
      const folded = fold(chunk);
      const at = findOwn(folded, own);
      if (at < 0) continue;

      const hasTime = terminator[4] !== undefined;
      const scheduledAt = localMs(Number(terminator[3]), Number(terminator[2]), Number(terminator[1]), hasTime ? Number(terminator[4]) : 0, hasTime ? Number(terminator[5]) : 0);
      if (scheduledAt === null) continue;

      const before = chunk.slice(0, at).trim();
      const after = chunk.slice(at + own.length).trim();
      const visiting = before.replace(/(?:\d+\s*)?[–—-]?\s*(?:\d+\s*)?$/, '').trim() !== '';
      if (visiting) {
        const { name, first, second } = splitScoreTail(before);
        fixtures.push({ matchday, matchdayDate, opponent: name, homeAway: 'AWAY', ownScore: second, opponentScore: first, venue: after || null, scheduledAt, hasTime });
      } else {
        const { first, second, rest } = splitScoreHead(after);
        const { opponent, venue } = splitOpponentAndVenue(rest);
        fixtures.push({ matchday, matchdayDate, opponent, homeAway: 'HOME', ownScore: first, opponentScore: second, venue, scheduledAt, hasTime });
      }
    }
  });
  return { competition, season, fixtures };
}
