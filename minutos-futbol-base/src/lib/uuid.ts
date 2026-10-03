/**
 * UUIDv7: ordenable por tiempo (48 bits de epoch ms) + aleatorio.
 *
 * - Monótono dentro del proceso: dos ids generados en el mismo milisegundo (o
 *   con el reloj del sistema hacia atrás) siguen ordenándose correctamente.
 * - Sin dependencias nativas. Si `crypto.getRandomValues` no existe (Hermes sin
 *   polyfill) cae a `Math.random`, suficiente para ids locales.
 */

type Rng = (bytes: Uint8Array) => void;

const defaultRng: Rng = (bytes) => {
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
};

let lastMs = 0;
let counter = 0;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuidv7(now: number = Date.now(), rng: Rng = defaultRng): string {
  let ms = Math.max(0, Math.floor(now));
  if (ms <= lastMs) {
    // Mismo ms o reloj hacia atrás: mantenemos el orden con el contador.
    ms = lastMs;
    counter += 1;
    if (counter > 0xfff) {
      lastMs += 1;
      ms = lastMs;
      counter = 0;
    }
  } else {
    lastMs = ms;
    counter = 0;
  }

  const b = new Uint8Array(16);
  rng(b);

  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = Math.floor(ms / 2 ** 24) & 0xff;
  b[3] = Math.floor(ms / 2 ** 16) & 0xff;
  b[4] = Math.floor(ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  // versión 7 + 12 bits de contador (rand_a)
  b[6] = 0x70 | ((counter >> 8) & 0x0f);
  b[7] = counter & 0xff;
  // variante RFC 4122
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[b[i] ?? 0];
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Epoch ms codificado en un UUIDv7 (útil para depurar y ordenar). */
export function uuidv7Timestamp(id: string): number | null {
  if (!isUuid(id) || id[14] !== '7') return null;
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/** Solo para tests: reinicia el estado monótono. */
export function _resetUuidv7StateForTests(): void {
  lastMs = 0;
  counter = 0;
}
