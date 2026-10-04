import { migrate } from '../migrate';
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '../schema';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';

describeWithSqlite('migrate contra SQLite real', () => {
  let native: NodeSqliteDatabase;

  const userVersion = () => (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const tables = () =>
    (native.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );

  beforeEach(() => {
    native = openMemoryDatabase();
  });

  afterEach(() => native.close());

  it('en una base nueva aplica todo y deja user_version = SCHEMA_VERSION', async () => {
    const db = createNodeSqliteDouble(native);
    expect(userVersion()).toBe(0);
    await migrate(db);
    expect(userVersion()).toBe(SCHEMA_VERSION);
    expect(tables()).toEqual(['app_meta', 'match_event', 'player', 'team']);
  });

  it('es idempotente: la segunda vez no abre ninguna transacción', async () => {
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    const spy = jest.spyOn(db, 'withExclusiveTransactionAsync');
    await migrate(db);
    expect(spy).not.toHaveBeenCalled();
    expect(userVersion()).toBe(SCHEMA_VERSION);
  });

  it('solo aplica las migraciones posteriores a la versión actual', async () => {
    const db = createNodeSqliteDouble(native);
    const next = SCHEMA_VERSION + 1;
    const extra: Migration[] = [...MIGRATIONS, { version: next, statements: ['CREATE TABLE extra (id TEXT PRIMARY KEY)'] }];
    await migrate(db);
    const spy = jest.spyOn(db, 'withExclusiveTransactionAsync');
    await migrate(db, extra);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(userVersion()).toBe(next);
    expect(tables()).toContain('extra');
  });

  it('una migración que falla se deshace entera y user_version no avanza', async () => {
    const db = createNodeSqliteDouble(native);
    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        version: SCHEMA_VERSION + 1,
        statements: ['CREATE TABLE extra (id TEXT PRIMARY KEY)', 'CREATE TABLE con error de sintaxis ('],
      },
    ];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(userVersion()).toBe(SCHEMA_VERSION);
    expect(tables()).not.toContain('extra');
    // La base sigue utilizable en la versión anterior.
    expect(tables()).toContain('match_event');
  });

  it('rechaza una base de una versión más nueva que la soportada', async () => {
    const db = createNodeSqliteDouble(native);
    native.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    await expect(migrate(db)).rejects.toThrow(/versión/);
  });
});
