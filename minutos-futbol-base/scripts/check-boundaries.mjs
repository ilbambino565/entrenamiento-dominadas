#!/usr/bin/env node
/**
 * Comprueba las fronteras entre módulos (ver docs/01-arquitectura.md).
 *
 *   core          → solo core, lib. Sin react / react-native / expo / zustand.
 *   camera        → camera, events, lib.          (NUNCA core, db, app-services)
 *   events        → events, core (tipos), camera (tipos), lib.
 *   db            → db, core, lib.
 *   app-services  → todo menos features / ui.
 *   features, ui  → todo.
 *   @supabase/*   → solo desde sync.
 *
 * Uso: node scripts/check-boundaries.mjs   (sale con código 1 si hay violaciones)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'src');

const ALLOWED = {
  core: ['core', 'lib'],
  camera: ['camera', 'events', 'lib'],
  events: ['events', 'core', 'camera', 'lib'],
  db: ['db', 'core', 'lib'],
  'app-services': ['app-services', 'core', 'camera', 'events', 'db', 'state', 'lib', 'sync'],
  state: ['state', 'core', 'camera', 'events', 'app-services', 'lib'],
  lib: ['lib'],
  sync: ['sync', 'core', 'db', 'lib'],
  features: null,
  ui: null,
};

const FORBIDDEN_PACKAGES = {
  core: [/^react($|\/)/, /^react-native($|\/)/, /^expo/, /^zustand/, /^@supabase\//],
  camera: [/^react($|\/)/, /^react-native($|\/)/, /^@supabase\//],
  events: [/^react($|\/)/, /^react-native($|\/)/, /^@supabase\//],
  db: [/^react($|\/)/, /^react-native($|\/)/, /^@supabase\//],
  'app-services': [/^react($|\/)/, /^react-native($|\/)/, /^@supabase\//],
  lib: [/^@supabase\//],
  state: [/^@supabase\//],
  features: [/^@supabase\//],
  ui: [/^@supabase\//],
};

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function moduleOf(file) {
  const rel = relative(SRC, file);
  if (rel.startsWith('..')) return null;
  return rel.split(sep)[0];
}

const violations = [];

for (const file of walk(SRC)) {
  const mod = moduleOf(file);
  if (!mod) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (!spec) continue;
    const display = relative(ROOT, file);

    if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      const targetMod = moduleOf(target);
      if (!targetMod) continue;
      const allowed = ALLOWED[mod];
      if (allowed && !allowed.includes(targetMod)) {
        violations.push(`${display}: "${mod}" no puede importar de "${targetMod}" (${spec})`);
      }
    } else {
      const forbidden = FORBIDDEN_PACKAGES[mod] ?? [];
      if (forbidden.some((re) => re.test(spec))) {
        violations.push(`${display}: "${mod}" no puede importar el paquete "${spec}"`);
      }
    }
  }
}

if (violations.length) {
  console.error('Violaciones de fronteras entre módulos:\n');
  for (const v of violations) console.error('  - ' + v);
  console.error(`\n${violations.length} violación(es).`);
  process.exit(1);
} else {
  console.log('Fronteras entre módulos: OK');
}
