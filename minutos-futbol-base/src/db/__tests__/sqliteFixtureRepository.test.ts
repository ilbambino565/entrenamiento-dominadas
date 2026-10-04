import { migrate } from '../migrate';
import { DB_PRAGMAS, MIGRATIONS, SCHEMA_VERSION } from '../schema';
import { createSqliteFixtureRepository } from '../sqliteFixtureRepository';
import { createSqliteMatchRepository } from '../sqliteMatchRepository';
import { createSqliteSquadRepository } from '../sqliteSquadRepository';
import { describeFixtureRepositoryContract, fixtureRepositoryError, makeFixture } from './fixtureRepositoryContract';
import { makeMatch } from './matchRepositoryContract';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';
import { TEAM_ID, makeTeam } from './squadRepositoryContract';

describeWithSqlite('SqliteFixtureRepository', () => {
  const opened: NodeSqliteDatabase[] = [];

  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  const open = async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    for (const pragma of DB_PRAGMAS) native.exec(pragma);
    const db = createNodeSqliteDouble(native);
    await migrate(db);
    return {
      native,
      fixtures: createSqliteFixtureRepository(db),
      squad: createSqliteSquadRepository(db),
      matches: createSqliteMatchRepository(db),
    };
  };

  describeFixtureRepositoryContract('SqliteFixtureRepository', open);

  it('migrar una base en versión 4 con equipo y partido a la 5 los conserva y crea fixture con su índice', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    for (const pragma of DB_PRAGMAS) native.exec(pragma);
    const db = createNodeSqliteDouble(native);
    const userVersion = () => (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

    await migrate(db, MIGRATIONS.slice(0, 4));
    expect(userVersion()).toBe(4);
    await createSqliteSquadRepository(db).saveTeam(makeTeam({ federationName: 'C.D. EJEMPLO "A"' }));
    await createSqliteMatchRepository(db).createMatch(makeMatch(1), []);

    await migrate(db);
    expect(userVersion()).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5);
    expect(await createSqliteSquadRepository(db).getTeam()).toEqual(makeTeam({ federationName: 'C.D. EJEMPLO "A"' }));
    expect((await createSqliteMatchRepository(db).getMatch('match-1'))?.opponent).toBe('Rival 1');
    expect((native.prepare('PRAGMA index_info(idx_fixture_team_date)').all() as { name: string }[]).map((i) => i.name)).toEqual(['team_id', 'scheduled_at']);

    const fixtures = createSqliteFixtureRepository(db);
    await fixtures.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    expect(await fixtures.listFixtures(TEAM_ID)).toEqual([makeFixture(1)]);
  });

  it('foreign_keys: un equipo inexistente falla con STORAGE (FOREIGN KEY) y deja lo anterior', async () => {
    const { fixtures, squad } = await open();
    await squad.saveTeam(makeTeam());
    await fixtures.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    const error = await fixtureRepositoryError(fixtures.replaceFixtures('nadie', [makeFixture(2, { teamId: 'nadie' })]));
    expect(error.code).toBe('STORAGE');
    expect(String((error.cause as Error).message)).toMatch(/FOREIGN KEY/);
    expect((await fixtures.listFixtures(TEAM_ID)).map((f) => f.id)).toEqual(['fixture-1']);
  });

  it('foreign_keys: vincular con un partido que no existe falla con STORAGE y no cambia el vínculo', async () => {
    const { fixtures, squad } = await open();
    await squad.saveTeam(makeTeam());
    await fixtures.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    const error = await fixtureRepositoryError(fixtures.linkMatch('fixture-1', 'no-existe', 5));
    expect(error.code).toBe('STORAGE');
    expect((await fixtures.listFixtures(TEAM_ID))[0]?.matchId).toBeNull();
  });

  it('una fila ilegible sale como CORRUPT con su id y la columna', async () => {
    const { fixtures, squad, native } = await open();
    await squad.saveTeam(makeTeam());
    await fixtures.replaceFixtures(TEAM_ID, [makeFixture(1)]);
    native.prepare('UPDATE fixture SET home_away = ? WHERE id = ?').run('NEUTRAL', 'fixture-1');
    const error = await fixtureRepositoryError(fixtures.listFixtures(TEAM_ID));
    expect(error.code).toBe('CORRUPT');
    expect(error.message).toContain('fixture-1');
    expect(error.message).toContain('home_away');
  });
});
