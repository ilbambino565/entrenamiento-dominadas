/**
 * Persistencia: timeline (EventStore) y equipo/plantilla (SquadRepository).
 * `openAppDatabase` (client.ts) NO se reexporta a propósito: es el único
 * archivo que importa `expo-sqlite` en ejecución y ese paquete no carga bajo
 * Jest, así que la raíz de composición lo importa directamente de
 * './db/client' y el resto del código (y sus tests) puede importar de aquí
 * sin arrastrarlo.
 */
export * from './eventStore';
export * from './schema';
export * from './mappers';
export * from './inMemoryEventStore';
export * from './sqliteEventStore';
export * from './migrate';
export * from './squadRepository';
export * from './squadMappers';
export * from './inMemorySquadRepository';
export * from './sqliteSquadRepository';
export * from './matchRepository';
export * from './matchMappers';
export * from './inMemoryMatchRepository';
export * from './sqliteMatchRepository';
export * from './fixtureRepository';
export * from './fixtureMappers';
export * from './inMemoryFixtureRepository';
export * from './sqliteFixtureRepository';
