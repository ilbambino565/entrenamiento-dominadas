# 2. Modelo de datos

## 2.1 Diagrama

```
Team 1───* Season 1───* Match 1───* MatchPlayer *───1 Player *───1 Team
                          │
                          ├──* MatchEvent      (log append-only: FUENTE DE VERDAD)
                          ├──* ClockSegment    (proyección: reloj en marcha)
                          └──* PlayerInterval  (proyección: jugador en campo)

Season 1───* Training 1───* Attendance *───1 Player          (fase 2)
```

## 2.2 Decisiones clave

1. **`MatchEvent` es la fuente de verdad del partido.** `PlayerInterval` y
   `ClockSegment` se **regeneran** siempre a partir de los eventos no anulados.
   En el esquema v1 solo se persiste `match_event` (más los campos derivados
   `match_time_ms` / `period`, que `load()` comprueba y repara al abrir); las
   tablas materializadas `clock_segment` y `player_interval` llegan en el hito
   M2 para las consultas de temporada. Esto cumple el requisito: los minutos se
   recalculan desde los intervalos y nunca existe un contador final como verdad.
2. **`ClockSegment`** es una entidad añadida a las pedidas. Representa los tramos
   en los que el reloj del partido está en marcha. Sin ella, una pausa obligaría a
   cortar y reabrir los intervalos de todos los jugadores. Con ella, el intervalo
   de un jugador solo significa "estaba en el campo"; el tiempo jugado es la
   intersección con el reloj en marcha.
3. **Timestamps en milisegundos epoch (INTEGER)**, no texto ISO: comparaciones
   exactas y sin problemas de zona horaria.
4. **UUIDv7** como clave primaria en todas las tablas.
5. **Campos de sincronización** en todas las tablas: `created_at`, `updated_at`,
   `deleted_at` (borrado lógico).

## 2.3 Esquema SQLite (MVP)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = FULL;
PRAGMA foreign_keys = ON;

CREATE TABLE team (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT,                     -- "Alevín"
  default_format   TEXT NOT NULL DEFAULT 'F7',
  crest_uri        TEXT,                     -- archivo local
  color_primary    TEXT,
  color_secondary  TEXT,
  display_name_mode TEXT NOT NULL DEFAULT 'full', -- full | first_initial | first
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE season (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES team(id),
  name       TEXT NOT NULL,                  -- "2026/27"
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE player (
  id             TEXT PRIMARY KEY,
  team_id        TEXT NOT NULL REFERENCES team(id),
  first_name     TEXT NOT NULL,
  last_name      TEXT,                       -- opcional
  shirt_number   INTEGER,
  usual_position TEXT,                       -- GK | DEF | MID | FWD (libre)
  is_goalkeeper  INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  photo_uri      TEXT,                       -- archivo local, opcional
  photo_consent  INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL,           -- reordenación manual
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE match (
  id                 TEXT PRIMARY KEY,
  team_id            TEXT NOT NULL REFERENCES team(id),
  season_id          TEXT NOT NULL REFERENCES season(id),
  opponent           TEXT NOT NULL,
  scheduled_at       INTEGER NOT NULL,       -- fecha
  format             TEXT NOT NULL,          -- F7 | F8 | F11 (copiado: inmutable)
  players_on_field   INTEGER NOT NULL,       -- copiado del formato (7)
  periods_count      INTEGER NOT NULL DEFAULT 2,
  period_duration_ms INTEGER NOT NULL,       -- 25 min = 1_500_000
  home_away          TEXT,                   -- HOME | AWAY | NULL
  competition        TEXT,
  matchday           TEXT,
  camera_settings    TEXT,                   -- JSON opcional (ver doc 7); NULL = cámara externa
  status             TEXT NOT NULL,          -- ver estados en doc 3 (proyección)
  current_period     INTEGER NOT NULL DEFAULT 0,
  started_at         INTEGER,                -- proyección
  finished_at        INTEGER,                -- proyección
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

-- Convocado en el partido + estado actual (proyección del log)
CREATE TABLE match_player (
  id            TEXT PRIMARY KEY,
  match_id      TEXT NOT NULL REFERENCES match(id),
  player_id     TEXT NOT NULL REFERENCES player(id),
  shirt_number  INTEGER,                     -- foto del dorsal en ese partido
  location      TEXT NOT NULL,               -- FIELD | BENCH   (proyección)
  pos_x         REAL,                        -- 0..1 sobre el campo (proyección)
  pos_y         REAL,
  is_goalkeeper INTEGER NOT NULL DEFAULT 0,  -- proyección
  in_initial_lineup INTEGER NOT NULL DEFAULT 0, -- alineación planificada
  was_starter   INTEGER NOT NULL DEFAULT 0,  -- en el campo al primer pitido (derivado)
  is_unavailable INTEGER NOT NULL DEFAULT 0, -- lesionado/expulsado: aviso al entrar
  added_late    INTEGER NOT NULL DEFAULT 0,
  bench_order   INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  UNIQUE (match_id, player_id)
);

-- TIMELINE / LOG DE EVENTOS (append-only; solo se modifican voided_at y los
-- campos derivados match_time_ms / period; al corregir, timestamp)
CREATE TABLE match_event (
  id                  TEXT PRIMARY KEY,      -- UUIDv7
  match_id            TEXT NOT NULL,
  seq                 INTEGER NOT NULL,      -- orden estricto dentro del partido
  type                TEXT NOT NULL,         -- ver catálogo
  timestamp           INTEGER NOT NULL,      -- epoch ms REAL (clave para el vídeo)
  match_time_ms       INTEGER NOT NULL,      -- reloj de partido en ese instante (derivado)
  period              INTEGER NOT NULL,      -- 0 antes del pitido (derivado)
  player_id           TEXT,                  -- jugador principal
  secondary_player_id TEXT,                  -- en SUBSTITUTION: el que sale
  metadata            TEXT NOT NULL,         -- JSON tipado por type
  source              TEXT NOT NULL,         -- user | system | camera
  voided_at           INTEGER,               -- anulado por DESHACER
  created_at          INTEGER NOT NULL,
  UNIQUE (match_id, seq)
);
CREATE INDEX idx_event_match_seq       ON match_event(match_id, seq);
CREATE INDEX idx_event_match_player    ON match_event(match_id, player_id);       -- "momentos de Hugo"
CREATE INDEX idx_event_match_secondary ON match_event(match_id, secondary_player_id);
CREATE INDEX idx_event_match_type      ON match_event(match_id, type);            -- goles, cambios
CREATE INDEX idx_event_match_time      ON match_event(match_id, timestamp);       -- sincronía con vídeo

-- PROYECCIÓN: tramos con el reloj del partido en marcha
CREATE TABLE clock_segment (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES match(id),
  period     INTEGER NOT NULL,               -- 1, 2, ...
  started_at INTEGER NOT NULL,
  ended_at   INTEGER                         -- NULL = en marcha ahora
);

-- PROYECCIÓN: presencia en el campo
CREATE TABLE player_interval (
  id              TEXT PRIMARY KEY,
  match_id        TEXT NOT NULL REFERENCES match(id),
  player_id       TEXT NOT NULL REFERENCES player(id),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,                   -- NULL = en el campo ahora
  start_event_id  TEXT NOT NULL REFERENCES match_event(id),
  end_event_id    TEXT REFERENCES match_event(id)
);
CREATE INDEX idx_interval_match_player ON player_interval(match_id, player_id);
-- Como mucho UN intervalo abierto por jugador y partido
CREATE UNIQUE INDEX uq_open_interval ON player_interval(match_id, player_id)
  WHERE ended_at IS NULL;

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- last_clock_seen (detección de saltos de reloj), etc. La versión del esquema
-- vive en PRAGMA user_version (transaccional con el DDL).
```

### Nota: lo que la migración 2 (hito M3) crea de verdad

`src/db/schema.ts` v2 crea solo `team` y `player`, con las columnas de
`src/core/team.ts` en snake_case. Diferencias respecto al diseño de arriba:

- **Columnas nuevas en `team`:** `default_formation` (dibujo por defecto de los
  titulares, `'3-1-2'`…; `NULL` = el de referencia del formato),
  `periods_count` (DEFAULT 2) y `period_duration_ms` (DEFAULT 1 500 000 = 25
  min). Son los valores que la pantalla Equipo (P4) propone al crear un
  partido; el partido sigue copiando los suyos y es inmutable.
- **Todavía sin crear:** `team.crest_uri`, `team.color_primary`,
  `team.color_secondary` y `player.usual_position`. Llegarán en una migración
  posterior cuando una pantalla las use (el escudo y los colores de la
  pantalla de partido vienen hoy del paquete de equipo). Tampoco existen aún
  `season` ni las proyecciones.
- **Migración 3 (`match`, `match_player`, hito M4):** `match` sin `season_id` ni
  `camera_settings` (el MVP no tiene temporadas ni cámara integrada; llegarán
  en una migración cuando una pantalla las use) y con índice
  `idx_match_scheduled ON match(scheduled_at)` para la lista de recientes.
  `match_player` solo con `shirt_number`, `is_goalkeeper`, `in_initial_lineup`
  y `bench_order`: `location`, `pos_x/y`, `was_starter`, `is_unavailable` y
  `added_late` son proyección del partido en curso y llegan con el paso que
  los use. `MatchRepository` (`createMatch` con su convocatoria en una
  transacción, `getMatch`, `listRecentMatches`, `listMatchPlayers`,
  `saveProgress`) tiene variante SQLite y en memoria con el mismo contrato.
- **`player.photo_uri`** admite un **data URI** (JPEG pequeño, recortado y
  comprimido) además de una URI de archivo local: así la foto viaja con la
  fila (copia, web con localStorage) y no se pierde si el archivo desaparece.
- `team.deleted_at` existe por la regla general aunque el MVP no borre
  equipos: `getTeam` devuelve el primer equipo sin `deleted_at` por
  `created_at`.
- Índice: `idx_player_team_order ON player(team_id, sort_order)`, la consulta
  de la plantilla (`WHERE team_id = ? AND deleted_at IS NULL ORDER BY
  sort_order, created_at, id`).

### Fase 2 (definidas, no implementadas)

```sql
CREATE TABLE training (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, season_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL, notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE attendance (
  id TEXT PRIMARY KEY, training_id TEXT NOT NULL REFERENCES training(id),
  player_id TEXT NOT NULL REFERENCES player(id),
  status TEXT NOT NULL,               -- PRESENT | ABSENT | EXCUSED | INJURED
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  UNIQUE (training_id, player_id)
);

-- Fase 3: sync_outbox(id, table_name, row_id, op, created_at, synced_at)
```

## 2.4 Catálogo de `MatchEvent` (código: `src/core/events.ts`)

Los jugadores implicados van siempre en `player_id` / `secondary_player_id`;
`metadata` solo lleva lo demás.

| type | player / secondary | metadata | Efecto |
|------|--------------------|----------|--------|
| `LINEUP_SET` | — | `{ field: [{playerId, position, goalkeeper?}], bench }` | Alineación antes del pitido; estado `READY` |
| `MATCH_STARTED` | — | `{}` | Abre el `ClockSegment` del periodo 1 y un intervalo por titular |
| `MATCH_PAUSED` | — | `{}` | Cierra el `ClockSegment` abierto |
| `MATCH_RESUMED` | — | `{}` | Abre un `ClockSegment` en el mismo periodo |
| `HALFTIME_STARTED` | — | `{}` | Cierra el segmento; estado `HALFTIME`; los intervalos no se tocan |
| `PERIOD_STARTED` | — | `{}` | Abre el segmento del periodo siguiente |
| `MATCH_ENDED` | — | `{ reason: 'NORMAL' \| 'SUSPENDED' }` | Cierra el segmento y **todos** los intervalos abiertos |
| `PLAYER_ENTERED` | entra / — | `{ position }` | Banquillo → campo: abre un intervalo |
| `PLAYER_LEFT` | sale / — | `{}` | Campo → banquillo: cierra el intervalo |
| `SUBSTITUTION` | entra / sale | `{ position }` | Atómico: cierra el de `sale` y abre el de `entra` con el **mismo** `timestamp` |
| `PLAYER_MOVED` | jugador / — | `{ position }` | Recolocación; sin efecto en el tiempo |
| `PLAYERS_SWAPPED` | a / b | `{}` | Intercambian posición; sin efecto en el tiempo |
| `GOALKEEPER_SET` | jugador / — | `{}` | Cambio de portero (prepara minutos como portero) |
| `PLAYER_ADDED` | jugador / — | `{}` | Llega tarde: se añade al banquillo |
| `PLAYER_UNAVAILABLE` | jugador / — | `{ unavailable, reason }` | Marcador visual (lesión, expulsión) |
| `GOAL` `ASSIST` `YELLOW_CARD` `RED_CARD` | jugador / — | `GOAL: { ownGoal? }`, resto `{}` | Fase 2. No afectan a los minutos |
| `CAMERA_RECORDING_STARTED` | — | `{ recordingId, deviceType }` | Origen del offset de vídeo |
| `CAMERA_RECORDING_PAUSED` `_RESUMED` `_STOPPED` | — | `{ recordingId }` | Cámara. No afectan a los minutos |
| `CAMERA_ZONE_CHANGED` | — | `{ zone, previousZone }` | Cámara (modo zonas futuro) |
| `EVENT_UNDONE` | — | `{ targetEventId }` | Informativo: el objetivo pasa a `voided_at` |

Entidad futura (vídeo): `recording(id, match_id, started_at, ended_at,
file_uri, manual_offset_ms)`; `CAMERA_RECORDING_STARTED` ya guarda lo necesario
para crearla.

## 2.5 Invariantes (comprobadas en el dominio y en los tests)

1. Cada jugador tiene como mucho **un** intervalo abierto (también lo garantiza un
   índice único parcial).
2. Los intervalos de un mismo jugador no se solapan y cumplen `started_at ≤ ended_at`.
3. Jugadores en el campo ≤ `players_on_field`.
4. Como mucho un `ClockSegment` abierto por partido, y solo en los estados
   `RUNNING`.
5. Con el partido `FINISHED` no hay nada abierto.
6. Los `seq` son consecutivos y únicos. Los `timestamp` normalmente no
   decrecen, pero no se exige: el reloj del sistema puede saltar y los cálculos
   nunca producen duraciones negativas. El orden de aplicación es siempre `seq`.
7. `location = FIELD` ⇔ el jugador tiene un intervalo abierto (antes del pitido,
   ⇔ está en la alineación).
8. `regenerar(eventos) == proyecciones guardadas`. Se comprueba al abrir un partido;
   si no coincide, gana el log y se reescriben las proyecciones.
