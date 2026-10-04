/**
 * Esquema SQLite: SQL plano versionado con `PRAGMA user_version`.
 *
 * - v1 (hito M1): la timeline (`match_event`) y `app_meta`.
 * - v2 (hito M3): equipo y plantilla (`team`, `player`).
 * - v3 (hito M4): partidos y convocatoria (`match`, `match_player`).
 * - v4: `team.federation_name` (nombre del equipo en el calendario de la federación).
 *
 * Las proyecciones (`clock_segment`, `player_interval`) llegarán como migraciones nuevas.
 * Una migración publicada NUNCA se edita: una base ya migrada no volvería a
 * ejecutarla y quedaría distinta de una base nueva.
 */

export const SCHEMA_VERSION = 4;

export interface Migration {
  /** Consecutivo desde 1. Se escribe en `PRAGMA user_version` al aplicarla. */
  version: number;
  /** Sentencias independientes; `migrate` las ejecuta en orden dentro de una transacción. */
  statements: string[];
}

/**
 * PRAGMAs de conexión. Solo `journal_mode` persiste en el archivo; los otros
 * dos hay que fijarlos en cada conexión que se abra.
 *
 * - WAL: las lecturas no bloquean la escritura y cada COMMIT es un añadido al
 *   log, no una reescritura del archivo principal: rápido y robusto.
 * - synchronous=FULL: fsync en cada COMMIT. Con WAL lo habitual es NORMAL,
 *   que puede perder las últimas transacciones si se va la batería; aquí cada
 *   evento es un gesto del entrenador que no se va a repetir, así que lo
 *   confirmado tiene que sobrevivir a un cierre forzoso en mitad del partido.
 * - foreign_keys=ON: SQLite no las comprueba por defecto. En v1 no hay claves
 *   foráneas, pero el hito M2 las tendrá y activarlo desde ya evita olvidarlo.
 */
export const DB_PRAGMAS: readonly string[] = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = FULL',
  'PRAGMA foreign_keys = ON',
];

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      // Timeline append-only: la fuente de verdad del partido. Solo cambian
      // `voided_at` (DESHACER) y los derivados `match_time_ms` / `period`
      // (regeneración). `timestamp` es epoch ms real: la clave para el vídeo.
      `CREATE TABLE match_event (
        id                  TEXT PRIMARY KEY,
        match_id            TEXT NOT NULL,
        seq                 INTEGER NOT NULL,
        type                TEXT NOT NULL,
        timestamp           INTEGER NOT NULL,
        match_time_ms       INTEGER NOT NULL,
        period              INTEGER NOT NULL,
        player_id           TEXT,
        secondary_player_id TEXT,
        metadata            TEXT NOT NULL,
        source              TEXT NOT NULL,
        voided_at           INTEGER,
        created_at          INTEGER NOT NULL,
        UNIQUE (match_id, seq)
      )`,
      // Lectura del partido: loadEvents (ORDER BY seq) y lastSeq (MAX(seq)).
      // UNIQUE(match_id, seq) ya crea un índice automático equivalente; este
      // deja el nombre explícito para EXPLAIN y para futuras migraciones.
      'CREATE INDEX idx_event_match_seq ON match_event (match_id, seq)',
      // "Momentos de Hugo": desde la ficha del jugador a sus eventos y, con el
      // vídeo, a sus clips. También alimenta sus intervalos al regenerar.
      'CREATE INDEX idx_event_match_player ON match_event (match_id, player_id)',
      // El mismo recorrido para el jugador secundario (el que sale en una
      // SUBSTITUTION, el otro en PLAYERS_SWAPPED): sin él se perderían sus salidas.
      'CREATE INDEX idx_event_match_secondary ON match_event (match_id, secondary_player_id)',
      // Listas por tipo: goles, cambios, y el último CAMERA_RECORDING_STARTED
      // (origen del offset del vídeo) sin recorrer toda la timeline.
      'CREATE INDEX idx_event_match_type ON match_event (match_id, type)',
      // Sincronía con el vídeo: eventos dentro de [inicio, fin] de una grabación
      // y timeline ordenada por tiempo real, que no siempre coincide con `seq`.
      'CREATE INDEX idx_event_match_time ON match_event (match_id, timestamp)',
      // Clave-valor de la app: `last_clock_seen` (detección de saltos del reloj
      // del sistema), avisos de integridad, etc. La versión del esquema NO va
      // aquí sino en `PRAGMA user_version`, que es transaccional con el DDL.
      'CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    ],
  },
  {
    version: 2,
    statements: [
      // Equipo (MVP: uno por instalación). Columnas = `core/team.ts` en
      // snake_case. `default_formation`, `periods_count` y `period_duration_ms`
      // no estaban en docs/02: son los valores por defecto que la pantalla
      // Equipo propone al crear un partido (ver nota en docs/02 §2.3).
      // `deleted_at` existe por la regla general de sincronización aunque el
      // MVP no borre equipos: `getTeam` ya filtra por él.
      `CREATE TABLE team (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        category           TEXT,
        default_format     TEXT NOT NULL DEFAULT 'F7',
        default_formation  TEXT,
        periods_count      INTEGER NOT NULL DEFAULT 2,
        period_duration_ms INTEGER NOT NULL DEFAULT 1500000,
        display_name_mode  TEXT NOT NULL DEFAULT 'full',
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        deleted_at         INTEGER
      )`,
      // Plantilla. Booleanos como INTEGER 0/1. `photo_uri` admite un data URI
      // (JPEG pequeño) además de un archivo local: así la foto viaja con la
      // fila y sobrevive a una copia o a la web. Eliminar = anonimizar y poner
      // `deleted_at` (su histórico en la timeline sigue apuntando a su id), por
      // eso no hay ON DELETE: nunca se borra físicamente.
      `CREATE TABLE player (
        id             TEXT PRIMARY KEY,
        team_id        TEXT NOT NULL REFERENCES team(id),
        first_name     TEXT NOT NULL,
        last_name      TEXT,
        shirt_number   INTEGER,
        is_goalkeeper  INTEGER NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        photo_uri      TEXT,
        photo_consent  INTEGER NOT NULL DEFAULT 0,
        sort_order     INTEGER NOT NULL,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        deleted_at     INTEGER
      )`,
      // La consulta de la plantilla: jugadores de un equipo en orden manual
      // (`listPlayers`: WHERE team_id = ? ORDER BY sort_order, created_at, id).
      'CREATE INDEX idx_player_team_order ON player (team_id, sort_order)',
    ],
  },
  {
    version: 3,
    statements: [
      // Partido. Columnas = `core/match.ts` en snake_case. Sin `season_id` ni
      // `camera_settings` (docs/02): el MVP no tiene temporadas ni cámara
      // integrada; llegarán en una migración cuando una pantalla las use.
      // Formato, jugadores en campo, partes y duración se copian del equipo al
      // crear y no cambian. `status`, `current_period`, `started_at` y
      // `finished_at` son proyección de la timeline (docs/03).
      `CREATE TABLE match (
        id                 TEXT PRIMARY KEY,
        team_id            TEXT NOT NULL REFERENCES team(id),
        opponent           TEXT NOT NULL,
        scheduled_at       INTEGER NOT NULL,
        format             TEXT NOT NULL,
        players_on_field   INTEGER NOT NULL,
        periods_count      INTEGER NOT NULL DEFAULT 2,
        period_duration_ms INTEGER NOT NULL,
        home_away          TEXT,
        competition        TEXT,
        matchday           TEXT,
        status             TEXT NOT NULL,
        current_period     INTEGER NOT NULL DEFAULT 0,
        started_at         INTEGER,
        finished_at        INTEGER,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        deleted_at         INTEGER
      )`,
      // La lista de partidos recientes: por fecha, de más nuevo a más viejo.
      'CREATE INDEX idx_match_scheduled ON match (scheduled_at)',
      // Convocatoria. Sin `location`, `pos_x/y`, `was_starter`, `is_unavailable`
      // ni `added_late`: son proyección del partido en curso y llegan con el
      // paso que los usa. `UNIQUE (match_id, player_id)`: nadie convocado dos veces.
      `CREATE TABLE match_player (
        id                TEXT PRIMARY KEY,
        match_id          TEXT NOT NULL REFERENCES match(id),
        player_id         TEXT NOT NULL REFERENCES player(id),
        shirt_number      INTEGER,
        is_goalkeeper     INTEGER NOT NULL DEFAULT 0,
        in_initial_lineup INTEGER NOT NULL DEFAULT 0,
        bench_order       INTEGER,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        deleted_at        INTEGER,
        UNIQUE (match_id, player_id)
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      // Cómo se llama el equipo en el calendario de la federación (RFAF): el
      // lector del calendario pegado lo usa para encontrar sus partidos. Puede
      // diferir del nombre que le da el entrenador ("Alevín A" vs "C.D. X "A""),
      // y es un dato del dispositivo: no entra en el repositorio. NULL = sin informar.
      'ALTER TABLE team ADD COLUMN federation_name TEXT',
    ],
  },
];
