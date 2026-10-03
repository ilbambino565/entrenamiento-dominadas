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

  it('crea app_meta y no crea todavía las tablas del hito M2', () => {
    const tables = names(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all());
    expect(tables).toEqual(['app_meta', 'match_event']);
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
});
