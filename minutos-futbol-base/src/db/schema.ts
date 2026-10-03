/**
 * Esquema SQLite: SQL plano versionado con `PRAGMA user_version`.
 *
 * Hito M1: solo la timeline (`match_event`) y `app_meta`. Las tablas de equipo,
 * plantilla, partido y proyecciones llegan en el hito M2 como migraciones
 * nuevas, nunca editando la v1: una base ya migrada no volvería a ejecutarla.
 */

export const SCHEMA_VERSION = 1;

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
];
