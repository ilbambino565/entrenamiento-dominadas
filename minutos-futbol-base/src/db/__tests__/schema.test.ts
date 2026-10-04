import { DB_PRAGMAS, MIGRATIONS, SCHEMA_VERSION } from '../schema';
import { describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';

describe('schema: migraciones declaradas', () => {
  it('las versiones son consecutivas desde 1 y SCHEMA_VERSION es la última', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
    for (const migration of MIGRATIONS) expect(migration.statements.length).toBeGreaterThan(0);
  });

  it('los PRAGMAs son WAL + synchronous=FULL + foreign_keys=ON', () => {
    expect(DB_PRAGMAS).toEqual(['PRAGMA journal_mode = WAL', 'PRAGMA synchronous = FULL', 'PRAGMA foreign_keys = ON']);
  });
});

/**
 * Si node:sqlite no está disponible esta suite se salta (ver nodeSqlite.ts) y
 * la sintaxis solo queda validada por la lectura; por eso el aviso en consola.
 */
describeWithSqlite('schema: DDL contra SQLite real', () => {
  let db: NodeSqliteDatabase;

  const names = (rows: unknown[]) => rows.map((r) => (r as { name: string }).name);

  beforeEach(() => {
    db = openMemoryDatabase();
    for (const migration of MIGRATIONS) for (const statement of migration.statements) db.exec(statement);
  });

  afterEach(() => db.close());

  it('los PRAGMAs se ejecutan sin error', () => {
    for (const pragma of DB_PRAGMAS) expect(() => db.exec(pragma)).not.toThrow();
  });

  it('crea match_event con las columnas, NOT NULL y clave primaria esperados', () => {
    const columns = db.prepare('PRAGMA table_info(match_event)').all() as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    expect(columns.map((c) => [c.name, c.type, c.notnull === 1, c.pk === 1])).toEqual([
      ['id', 'TEXT', false, true],
      ['match_id', 'TEXT', true, false],
      ['seq', 'INTEGER', true, false],
      ['type', 'TEXT', true, false],
      ['timestamp', 'INTEGER', true, false],
      ['match_time_ms', 'INTEGER', true, false],
      ['period', 'INTEGER', true, false],
      ['player_id', 'TEXT', false, false],
      ['secondary_player_id', 'TEXT', false, false],
      ['metadata', 'TEXT', true, false],
      ['source', 'TEXT', true, false],
      ['voided_at', 'INTEGER', false, false],
      ['created_at', 'INTEGER', true, false],
    ]);
  });

  it('crea los índices de navegación con las columnas previstas', () => {
    const indexColumns = (index: string) => names(db.prepare(`PRAGMA index_info(${index})`).all());
    expect(indexColumns('idx_event_match_seq')).toEqual(['match_id', 'seq']);
    expect(indexColumns('idx_event_match_player')).toEqual(['match_id', 'player_id']);
    expect(indexColumns('idx_event_match_secondary')).toEqual(['match_id', 'secondary_player_id']);
    expect(indexColumns('idx_event_match_type')).toEqual(['match_id', 'type']);
    expect(indexColumns('idx_event_match_time')).toEqual(['match_id', 'timestamp']);

    const unique = (db.prepare('PRAGMA index_list(match_event)').all() as { name: string; unique: number }[])
      .filter((i) => i.unique === 1)
      .map((i) => indexColumns(i.name));
    expect(unique).toContainEqual(['match_id', 'seq']);
  });

  it('crea app_meta, team y player (v2) y todavía ninguna tabla de partido ni proyección', () => {
    const tables = names(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all());
    expect(tables).toEqual(['app_meta', 'match_event', 'player', 'team']);
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('last_clock_seen', '1700000000000');
    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('last_clock_seen')).toMatchObject({
      value: '1700000000000',
    });
  });

  it('acepta inserts y selects y hace cumplir UNIQUE(match_id, seq) y los NOT NULL', () => {
    const insert = db.prepare(
      'INSERT INTO match_event (id, match_id, seq, type, timestamp, match_time_ms, period, player_id, secondary_player_id, metadata, source, voided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('e1', 'm1', 1, 'MATCH_STARTED', 1700000000000, 0, 1, null, null, '{}', 'user', null, 1700000000001);
    insert.run('e2', 'm2', 1, 'MATCH_STARTED', 1700000000000, 0, 1, null, null, '{}', 'user', null, 1700000000001);

    expect(() => insert.run('e3', 'm1', 1, 'GOAL', 1, 0, 1, 'hugo', null, '{}', 'user', null, 1)).toThrow(/UNIQUE/);
    expect(() => insert.run('e1', 'm1', 2, 'GOAL', 1, 0, 1, 'hugo', null, '{}', 'user', null, 1)).toThrow(/UNIQUE/);
    expect(() => insert.run('e4', 'm1', 2, 'GOAL', 1, 0, 1, 'hugo', null, null, 'user', null, 1)).toThrow(/NOT NULL/);

    const rows = db.prepare('SELECT id, seq FROM match_event WHERE match_id = ? ORDER BY seq').all('m1');
    expect(rows).toEqual([{ id: 'e1', seq: 1 }]);
    expect(db.prepare('SELECT COALESCE(MAX(seq), 0) AS last_seq FROM match_event WHERE match_id = ?').get('m3')).toEqual(
      { last_seq: 0 },
    );
  });

  // Columnas de la v2 = `core/team.ts` en snake_case; los DEFAULT son los del formato F7.
  const columnInfo = (table: string) =>
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[]
    ).map((c) => [c.name, c.type, c.notnull === 1, c.dflt_value, c.pk === 1]);

  it('v2: crea team con las columnas, NOT NULL y DEFAULT esperados', () => {
    expect(columnInfo('team')).toEqual([
      ['id', 'TEXT', false, null, true],
      ['name', 'TEXT', true, null, false],
      ['category', 'TEXT', false, null, false],
      ['default_format', 'TEXT', true, "'F7'", false],
      ['default_formation', 'TEXT', false, null, false],
      ['periods_count', 'INTEGER', true, '2', false],
      ['period_duration_ms', 'INTEGER', true, '1500000', false],
      ['display_name_mode', 'TEXT', true, "'full'", false],
      ['created_at', 'INTEGER', true, null, false],
      ['updated_at', 'INTEGER', true, null, false],
      ['deleted_at', 'INTEGER', false, null, false],
    ]);
  });

  it('v2: crea player con las columnas, NOT NULL y DEFAULT esperados, la FK a team y el índice de orden', () => {
    expect(columnInfo('player')).toEqual([
      ['id', 'TEXT', false, null, true],
      ['team_id', 'TEXT', true, null, false],
      ['first_name', 'TEXT', true, null, false],
      ['last_name', 'TEXT', false, null, false],
      ['shirt_number', 'INTEGER', false, null, false],
      ['is_goalkeeper', 'INTEGER', true, '0', false],
      ['is_active', 'INTEGER', true, '1', false],
      ['photo_uri', 'TEXT', false, null, false],
      ['photo_consent', 'INTEGER', true, '0', false],
      ['sort_order', 'INTEGER', true, null, false],
      ['created_at', 'INTEGER', true, null, false],
      ['updated_at', 'INTEGER', true, null, false],
      ['deleted_at', 'INTEGER', false, null, false],
    ]);
    expect(db.prepare('PRAGMA foreign_key_list(player)').all()).toEqual([
      expect.objectContaining({ table: 'team', from: 'team_id', to: 'id' }),
    ]);
    expect(names(db.prepare('PRAGMA index_info(idx_player_team_order)').all())).toEqual(['team_id', 'sort_order']);
  });

  it('v2: los DEFAULT rellenan un equipo mínimo y, con foreign_keys=ON, un jugador sin equipo se rechaza', () => {
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare('INSERT INTO team (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('t1', 'CD Prueba', 1, 1);
    expect(db.prepare('SELECT default_format, default_formation, periods_count, period_duration_ms, display_name_mode FROM team').get()).toEqual({
      default_format: 'F7',
      default_formation: null,
      periods_count: 2,
      period_duration_ms: 1_500_000,
      display_name_mode: 'full',
    });

    const insertPlayer = db.prepare(
      'INSERT INTO player (id, team_id, first_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertPlayer.run('p1', 't1', 'Ana', 0, 1, 1);
    expect(db.prepare('SELECT is_goalkeeper, is_active, photo_consent, shirt_number, deleted_at FROM player').get()).toEqual({
      is_goalkeeper: 0,
      is_active: 1,
      photo_consent: 0,
      shirt_number: null,
      deleted_at: null,
    });
    expect(() => insertPlayer.run('p2', 'nadie', 'Bea', 1, 1, 1)).toThrow(/FOREIGN KEY/);
    expect(() => insertPlayer.run('p3', 't1', null, 2, 1, 1)).toThrow(/NOT NULL/);
  });
});
