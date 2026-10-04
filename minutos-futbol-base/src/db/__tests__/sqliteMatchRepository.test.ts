import { migrate } from '../migrate';
import { DB_PRAGMAS, MIGRATIONS } from '../schema';
import { createSqliteMatchRepository } from '../sqliteMatchRepository';
import { createSqliteSquadRepository } from '../sqliteSquadRepository';
import { createNodeSqliteDouble, describeWithSqlite, openMemoryDatabase, type NodeSqliteDatabase } from './nodeSqlite';
import { describeMatchRepositoryContract, makeMatch, makeMatchPlayer, matchRepositoryError } from './matchRepositoryContract';
import { TEAM_ID, makePlayer, makeTeam } from './squadRepositoryContract';

describeWithSqlite('SqliteMatchRepository', () => {
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
    return { native, matches: createSqliteMatchRepository(db), squad: createSqliteSquadRepository(db) };
  };

  describeMatchRepositoryContract('SqliteMatchRepository', open);

  it('migrar una base en versión 2 con equipo y plantilla a la 3 los conserva y crea match y match_player', async () => {
    const native = openMemoryDatabase();
    opened.push(native);
    for (const pragma of DB_PRAGMAS) native.exec(pragma);
    const db = createNodeSqliteDouble(native);
    const userVersion = () => (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

    await migrate(db, MIGRATIONS.slice(0, 2));
    expect(userVersion()).toBe(2);
    // En v2 `team` aún no tiene `federation_name`: el repositorio de hoy no sirve, se inserta a mano.
    const team = makeTeam();
    const player = makePlayer(1);
    native
      .prepare('INSERT INTO team (id, name, category, default_format, default_formation, periods_count, period_duration_ms, display_name_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(team.id, team.name, team.category, team.defaultFormat, team.defaultFormation, team.periodsCount, team.periodDurationMs, team.displayNameMode, team.createdAt, team.updatedAt);
    native
      .prepare('INSERT INTO player (id, team_id, first_name, last_name, shirt_number, is_goalkeeper, is_active, photo_uri, photo_consent, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(player.id, player.teamId, player.firstName, player.lastName, player.shirtNumber, 1, 1, null, 0, player.sortOrder, player.createdAt, player.updatedAt);

    await migrate(db, MIGRATIONS.slice(0, 3));
    expect(userVersion()).toBe(3);
    await migrate(db);
    expect(userVersion()).toBe(4);
    const tables = (native.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['app_meta', 'match', 'match_event', 'match_player', 'player', 'team']);
    const squad = createSqliteSquadRepository(db);
    expect(await squad.getTeam()).toEqual(team);
    expect(await squad.listPlayers(TEAM_ID)).toEqual([player]);

    const matches = createSqliteMatchRepository(db);
    await matches.createMatch(makeMatch(1), [makeMatchPlayer('match-1', 1)]);
    expect(await matches.listMatchPlayers('match-1')).toEqual([makeMatchPlayer('match-1', 1)]);
  });

  it('foreign_keys: un partido de un equipo inexistente falla con STORAGE (FOREIGN KEY) y no se guarda', async () => {
    const { matches, native } = await open();
    const error = await matchRepositoryError(matches.createMatch(makeMatch(1, { teamId: 'nadie' }), []));
    expect(error.code).toBe('STORAGE');
    expect(String((error.cause as Error).message)).toMatch(/FOREIGN KEY/);
    expect(native.prepare('SELECT COUNT(*) AS n FROM match').get()).toEqual({ n: 0 });
  });

  it('foreign_keys: un convocado que no está en la plantilla deshace también el partido', async () => {
    const { matches, squad, native } = await open();
    await squad.saveTeam(makeTeam());
    await squad.savePlayer(makePlayer(1));
    const error = await matchRepositoryError(
      matches.createMatch(makeMatch(1), [makeMatchPlayer('match-1', 1), makeMatchPlayer('match-1', 2)]),
    );
    expect(error.code).toBe('STORAGE');
    expect(String((error.cause as Error).message)).toMatch(/FOREIGN KEY/);
    expect(native.prepare('SELECT COUNT(*) AS n FROM match').get()).toEqual({ n: 0 });
    expect(native.prepare('SELECT COUNT(*) AS n FROM match_player').get()).toEqual({ n: 0 });
  });

  it('getMatch devuelve también un partido con deleted_at, pero la lista de recientes lo omite', async () => {
    const { matches, squad, native } = await open();
    await squad.saveTeam(makeTeam());
    await matches.createMatch(makeMatch(1), []);
    await matches.createMatch(makeMatch(2), []);
    native.prepare('UPDATE match SET deleted_at = ? WHERE id = ?').run(1, 'match-1');
    expect((await matches.listRecentMatches()).map((m) => m.id)).toEqual(['match-2']);
    expect((await matches.getMatch('match-1'))?.id).toBe('match-1');
  });

  it('una fila ilegible sale como CORRUPT con su id y la columna', async () => {
    const { matches, squad, native } = await open();
    await squad.saveTeam(makeTeam());
    await matches.createMatch(makeMatch(1), []);
    native.prepare('UPDATE match SET status = ? WHERE id = ?').run('EXTRA', 'match-1');
    const error = await matchRepositoryError(matches.getMatch('match-1'));
    expect(error.code).toBe('CORRUPT');
    expect(error.message).toContain('match-1');
    expect(error.message).toContain('status');
  });
});
