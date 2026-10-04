# 8. Estado del proyecto y siguiente paso

Nota de traspaso para retomar el trabajo en una conversación nueva sin releer
el historial. Actualízala al cerrar cada hito.

## 8.1 Dónde está el código

- Repositorio público `ilbambino565/entrenamiento-dominadas`, carpeta
  `minutos-futbol-base/`, rama `ccr-210afedc-9imprm`.
- **Privacidad (regla fija):** los datos reales (nombres, dorsales, fotos de
  los niños) NUNCA entran en el repositorio ni en los tests. Viven solo en el
  dispositivo del entrenador (SQLite) y, para la vista previa web, en un
  archivo `team-pack.js` que acompaña a la página privada y no está en git.
  Los tests usan nombres inventados (Ana, Bea, Cris…).

## 8.2 Qué hay hecho (hitos M1, M2 parcial, M3, M4 y la pantalla P8)

- `src/core`: dominio puro (eventos, reducer, tiempos, dibujos, plantilla).
- `src/db`: SQLite versionado (migración 1: timeline; 2: equipo y plantilla;
  3: partido y convocatoria), repositorios de eventos, plantilla y partidos, variante en memoria con
  `localStorage` para web.
- `src/app-services`: `MatchEngine` (partido), `SquadService` (plantilla),
  cámara desacoplada (dormida).
- `src/features/live-match`: P8 partido en vivo (campo, banquillo, reloj,
  deshacer, dibujos, resumen P9 básico).
- `src/features/match-setup`: P5 Datos del partido (`MatchSetupScreen`; dominio
  en `core/matchSetup.ts`) P6 Convocatoria (`ConvocationScreen`; dominio en
  `core/convocation.ts`) y P7 Alineación (`LineupScreen`), enlazadas en el shell.
- `src/features/squad`: P2 Plantilla, P3 Jugador, P4 Equipo.
- `src/features/shell`: pestañas Partidos/Plantilla/Equipo, primer arranque,
  siembra desde el paquete, JUGAR PARTIDO → asistente P5-P7 → partido guardado.
- Verificación: `npm run verify` (tsc + fronteras + jest). Exportación web:
  `npx expo export --platform web --output-dir dist-web`.

## 8.3 Hito M4 "Crear partido" + P0 recuperación (hecho)

Orden propuesto, en pasos pequeños (cada uno con tests y commit):

1. ✅ **Tabla `match` y repositorio** (`src/db`): migración 3 con `match` y
   `match_player` (docs/02), `MatchRepository` (crear, listar recientes,
   marcar estado/finalizado) con contrato en memoria + SQLite.
2. ✅ **P5 Datos del partido** (pantalla y dominio hechos; aún sin enlazar en
   la navegación, se conecta con P6/P7): rival, fecha, partes × minutos (por defecto los
   del equipo). Pantalla sencilla en `src/features/match-setup/`.
3. ✅ **P6 Convocatoria** (`ConvocationScreen` y `core/convocation.ts`, sin
   enlazar aún): lista de activos con todos marcados por defecto.
4. ✅ **P7 Alineación** (`LineupScreen`, sin enlazar aún): reutiliza
   `Pitch`/`Bench` con un motor propio en memoria (el borrador no se guarda) y
   entrega titulares y banquillo con INICIAR PARTIDO; P8 los recibe por sus
   props `lineup`/`bench` y arranca en READY.
5. ✅ **Partido persistente**: `openPersistence(.web)` abre plantilla, partidos
   y timeline juntos (SQLite en nativo; en web, memoria con copia en
   `localStorage`: plantilla, partidos y una clave de timeline por partido). JUGAR PARTIDO abre P5→P6→P7;
   INICIAR PARTIDO crea `match` + `match_player` y la sesión con el
   `EventStore` persistente y el `matchId` del repositorio
   (`shell/startMatch.ts`). `trackMatchProgress` mantiene `status`,
   `currentPeriod`, `startedAt` y `finishedAt` al día con el motor, también al
   FINALIZAR; los minutos no se copian a `match` (se regeneran de la timeline).
6. ✅ **P0 "Hay un partido en curso"**: al arrancar, con el equipo cargado, el
   shell busca con `MatchRepository.findInProgressMatch()` el partido más
   reciente en RUNNING, PAUSED o HALFTIME (DRAFT y READY no se ofrecen: no hay
   nada que recuperar). `findResumable` regenera su estado de la timeline y
   `ResumeMatchScreen` muestra rival, parte, reloj y estado; CONTINUAR PARTIDO
   abre P8 con `resumeMatch` (sesión sobre la misma timeline, sin repetir la
   alineación). Un convocado ya eliminado de la plantilla sale como "Jugador
   eliminado". No hay (todavía) forma de descartar el partido sin continuarlo:
   se termina desde P8. En web también funciona al recargar la página (ver
   "Web" más abajo).
7. ✅ **P1 Partidos**: `MatchesHome` lista los 20 más recientes
   (`sáb 27/09 · vs rival · estado`) bajo JUGAR PARTIDO y se relee al volver a
   las pestañas. Un partido terminado (✓) abre el resumen `SummarySheet`
   (`viewMatch`: motor propio que solo lee la timeline); uno listo o en curso
   se reabre en P8; uno sin empezar (DRAFT) no responde. Limitaciones: la fila
   no distingue "suspendido" (el motivo del final solo está en la timeline) y no
   hay borrar partidos.

**Web (persistencia).** `InMemoryEventStore` y `InMemoryMatchRepository`
aceptan un `storage` (localStorage). La timeline va una clave por partido
(`minutos-futbol-base.events.v1.<matchId>`, filas `match_event` en JSON) y se
lee de forma perezosa; los partidos, en `minutos-futbol-base.matches.v1`. Cada
escritura se confirma en el storage ANTES de actualizar la memoria (si falla, la
promesa rechaza y la pantalla no muestra lo no guardado). Una timeline ilegible
NO se descarta ni se pisa: ese partido no abre (la timeline es la verdad); unos
`matches` ilegibles sí se copian a `.corrupt` y se arranca vacío, como la
plantilla. Límite: la cuota de `localStorage` (~5 MB) la comen sobre todo las
fotos de la plantilla; con el almacenamiento lleno, guardar rechaza. Sin
localStorage (navegación privada) todo vive solo en memoria.

**Hito M4 completo.** Siguiente (docs/06): M5/M6, ver el roadmap antes de
empezar. Cosas conocidas pendientes: descartar
un partido atascado, avisar en pantalla si el almacenamiento web se llena, "suspendido" en la lista, y los 13 errores de
`expo lint` anteriores a M4 (`ClockBar`, `useDragAndDrop`).

## 8.4 Cómo trabajar barato

- Sin workflows ni enjambres de agentes: un cambio concreto por mensaje,
  verificado con `npm run verify`.
- Las decisiones de diseño ya están tomadas en docs/01-07; no reabrirlas.
- Para ver la app en el móvil sin compilar: exportar web y publicar la
  página privada (ver README).
