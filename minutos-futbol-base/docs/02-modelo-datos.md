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
   `ClockSegment` se guardan materializados (para consultar y para las
   estadísticas de temporada), pero se pueden **regenerar** siempre a partir de los
   eventos no anulados. Esto cumple el requisito: los minutos se recalculan desde
   los intervalos y nunca existe un contador final como verdad.
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

-- LOG DE EVENTOS (append-only; solo se modifican voided_* y, al corregir, ts)
CREATE TABLE match_event (
  id          TEXT PRIMARY KEY,              -- UUIDv7
  match_id    TEXT NOT NULL REFERENCES match(id),
  seq         INTEGER NOT NULL,              -- orden estricto dentro del partido
  type        TEXT NOT NULL,                 -- ver catálogo
  ts          INTEGER NOT NULL,              -- epoch ms en el que ocurrió
  payload     TEXT NOT NULL,                 -- JSON tipado por type
  voided_at   INTEGER,                       -- anulado por DESHACER
  corrected_from_ts INTEGER,                 -- ts original si se corrigió
  created_at  INTEGER NOT NULL,
  UNIQUE (match_id, seq)
);
CREATE INDEX idx_event_match ON match_event(match_id, seq);

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
-- schema_version, last_clock_seen (detección de saltos de reloj), etc.
```

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

## 2.4 Catálogo de `MatchEvent` (MVP)

| type | payload | Efecto |
|------|---------|--------|
| `LINEUP_SET` | `{ field: [{playerId, x, y, gk}], bench: [playerId] }` | Estado inicial antes del pitido |
| `PERIOD_START` | `{ period }` | Abre un `ClockSegment`. En el periodo 1 marca a los titulares |
| `PAUSE` | `{}` | Cierra el `ClockSegment` abierto |
| `RESUME` | `{}` | Abre un `ClockSegment` en el mismo periodo |
| `PERIOD_END` | `{ period }` | Cierra el segmento; estado `HALFTIME` (o fin si era el último periodo y se confirma) |
| `MATCH_END` | `{ reason: 'NORMAL' \| 'SUSPENDED' }` | Cierra el segmento y **todos** los intervalos abiertos |
| `PLAYER_IN` | `{ playerId, x, y }` | Banquillo → campo: abre un intervalo |
| `PLAYER_OUT` | `{ playerId }` | Campo → banquillo: cierra el intervalo |
| `SUBSTITUTION` | `{ inId, outId, x, y }` | Atómico: cierra el de `out` y abre el de `in` con el **mismo** `ts` |
| `SWAP_ON_FIELD` | `{ aId, bId }` | Intercambia posiciones; sin efecto en el tiempo |
| `MOVE` | `{ playerId, x, y }` | Recolocación en el campo; sin efecto en el tiempo |
| `SET_GOALKEEPER` | `{ playerId }` | Cambio de portero (prepara minutos como portero) |
| `PLAYER_ADDED` | `{ playerId }` | Llega tarde: se añade a la convocatoria en el banquillo |
| `MARK_UNAVAILABLE` | `{ playerId, reason: 'INJURY' \| 'RED' \| 'OTHER' }` | Solo un marcador visual |
| `UNDO` | `{ targetEventId }` | Informativo: el objetivo pasa a `voided_at` |

Fase 2 y siguientes: `GOAL`, `ASSIST`, `CARD`, `INJURY`, `NOTE`... no afectan al
cálculo de minutos.

## 2.5 Invariantes (comprobadas en el dominio y en los tests)

1. Cada jugador tiene como mucho **un** intervalo abierto (también lo garantiza un
   índice único parcial).
2. Los intervalos de un mismo jugador no se solapan y cumplen `started_at ≤ ended_at`.
3. Jugadores en el campo ≤ `players_on_field`.
4. Como mucho un `ClockSegment` abierto por partido, y solo en los estados
   `RUNNING`.
5. Con el partido `FINISHED` no hay nada abierto.
6. Los `seq` son consecutivos y los `ts` no decrecen (salvo correcciones
   explícitas, que se reordenan al regenerar).
7. `location = FIELD` ⇔ el jugador tiene un intervalo abierto (antes del pitido,
   ⇔ está en la alineación).
8. `regenerar(eventos) == proyecciones guardadas`. Se comprueba al abrir un partido;
   si no coincide, gana el log y se reescriben las proyecciones.
