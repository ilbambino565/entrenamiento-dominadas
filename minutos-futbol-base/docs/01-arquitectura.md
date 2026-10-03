# 1. Análisis y arquitectura

## 1.1 Análisis del proyecto

### Qué es realmente el producto

Es un **cronómetro distribuido por jugador cuyo único mando es la posición del
jugador** (campo o banquillo). Todo lo demás (plantilla, convocatoria,
estadísticas) existe para alimentar ese momento o para explotar sus datos.

### Contexto de uso (lo que condiciona el diseño)

- Entrenador o delegado de pie en la banda, con **una mano** libre, al sol, a veces
  con lluvia o con frío, mirando el partido y no el móvil.
- Cobertura mala o inexistente en muchos campos municipales.
- El móvil se bloquea, entra una llamada, se cambia a WhatsApp, la batería baja.
- Partidos de 2×25 (F7 alevín/benjamín) o 2×30 / 4×12,5 según la federación.
- Muchos cambios: en F7 con 12-14 convocados puede haber más de 20 movimientos.
- Datos de **menores**: privacidad por diseño y RGPD.

### Riesgos principales (por orden)

| Riesgo | Impacto | Mitigación (resumen) |
|--------|---------|----------------------|
| Tiempos incorrectos por app en segundo plano o cerrada | Crítico: la app pierde su razón de ser | Timestamps reales, nada de contadores; estado reconstruido desde la BD ([doc 3](03-cronometraje.md)) |
| Pérdida o corrupción del partido | Crítico | Log de eventos append-only en SQLite (WAL), transacción por acción, proyecciones reconstruibles |
| Drag & drop impreciso o accidental | Alto | Zonas grandes, resaltado del destino, háptica, deshacer siempre visible, alternativa por toques ([doc 4](04-drag-and-drop.md)) |
| Interfaz sobrecargada | Alto | Un único gesto principal; controles del reloj contextuales (solo el siguiente paso lógico) |
| Alcance que se desborda | Alto | Roadmap estricto; las fases 2 y 3 no se tocan hasta cerrar el MVP |
| Cambio de hora del sistema durante el partido | Medio | Detección de saltos de reloj y aviso ([doc 3](03-cronometraje.md#saltos-del-reloj-del-sistema)) |

## 1.2 Arquitectura propuesta

### Principios

1. **Local-first.** SQLite en el dispositivo es la fuente de verdad. La red nunca
   participa en una acción del partido.
2. **Event sourcing ligero para el partido.** Cada acción del entrenador es un
   `MatchEvent` inmutable. Los intervalos de juego (`PlayerInterval`) y los
   tramos de reloj (`ClockSegment`) son **proyecciones materializadas** que siempre
   se pueden regenerar a partir de los eventos. Deshacer y corregir equivalen a
   anular o editar eventos y regenerar las proyecciones.
3. **Los minutos no se guardan nunca: se calculan.**
   `minutos = Σ (intervalo en campo ∩ reloj en marcha)`.
4. **Núcleo de dominio puro.** Toda la lógica de partido es TypeScript puro sin
   dependencias de React Native, determinista (recibe `now` como parámetro) y con
   tests exhaustivos.
5. **El formato de juego es configuración**, no código (`GameFormat`: F7, F8, F11).

### Capas

```
┌──────────────────────────────────────────────────────────────┐
│ UI (Expo Router, componentes RN)                             │
│  Pantallas · Campo · Banquillo · Tarjeta jugador · Reloj     │
│  Gestos: RNGH + Reanimated (hilo UI)                         │
├──────────────────────────────────────────────────────────────┤
│ Estado de app (Zustand)                                      │
│  matchStore: estado derivado del partido en curso            │
│  clockTick: "now" cada 1 s (solo para repintar)              │
├──────────────────────────────────────────────────────────────┤
│ Aplicación (casos de uso / comandos)                         │
│  substitute() · movePlayer() · startPeriod() · undo() ...    │
│  Cola serie de comandos → 1 transacción SQLite por comando   │
├──────────────────────────────────────────────────────────────┤
│ Dominio (TS puro, sin RN)                                    │
│  reducer(events) → MatchState                                │
│  projectIntervals(events) · playedMs(intervals, segments, now)│
│  invariantes · GameFormat · planificador (fase 2)            │
├──────────────────────────────────────────────────────────────┤
│ Persistencia                                                 │
│  expo-sqlite (WAL) + Drizzle (esquema + migraciones)         │
│  Repositorios: TeamRepo, PlayerRepo, MatchRepo, EventStore   │
│  Fotos: expo-file-system (directorio privado de la app)      │
├──────────────────────────────────────────────────────────────┤
│ Sincronización (FASE 3)                                      │
│  outbox → Supabase (Postgres + RLS) cuando haya red          │
└──────────────────────────────────────────────────────────────┘
```

### Flujo de una acción (p. ej. sustitución directa)

```
dedo suelta Hugo sobre Lucas
  → ts = Date.now()               (capturado en el instante de soltar)
  → comando substitute({in: Hugo, out: Lucas, ts})
  → validación con el dominio (invariantes)
  → BEGIN; INSERT match_event; UPDATE proyecciones; COMMIT;   (~2-5 ms)
  → matchStore se actualiza a partir del nuevo estado
  → háptica + animación
```

Si la transacción falla, la UI no cambia y se muestra un aviso. Nunca puede haber
un estado visible que no esté guardado.

### Stack

| Necesidad | Elección | Motivo |
|-----------|----------|--------|
| App | **Expo (SDK actual) + React Native + TypeScript estricto** | Una base de código para iOS y Android, OTA updates, EAS Build |
| Navegación | **Expo Router** | Basado en archivos, deep links gratis, sencillo |
| BD local | **expo-sqlite** (modo WAL, `synchronous=FULL`) | Transaccional y duradero; API síncrona disponible |
| ORM / migraciones | **Drizzle ORM** | Tipado, migraciones versionadas, compatible con expo-sqlite |
| Estado | **Zustand** | Mínimo, sin boilerplate; selectores para evitar re-renders |
| Gestos | **react-native-gesture-handler + Reanimated** | Arrastre a 60 fps en el hilo UI |
| Háptica | expo-haptics | Confirmación sin mirar la pantalla |
| Pantalla encendida | expo-keep-awake | Opcional durante el partido |
| Fotos | expo-image-picker + expo-image-manipulator + expo-image | Recorte a 256×256 y compresión; caché |
| IDs | **UUIDv7** | Ordenables por tiempo y sin colisiones al sincronizar |
| Tests | Jest (dominio) + **fast-check** (propiedades) + RNTL + **Maestro** (E2E) | El núcleo de tiempos necesita tests por propiedades |
| Calidad | ESLint, Prettier, `tsc --noEmit`, GitHub Actions | |
| Nube (fase 3) | **Supabase** (Postgres, Auth, Storage, RLS), región UE | Encaja con SQL local y RGPD |

### Por qué Expo y no una PWA

Casi todos los proyectos parecidos son PWA ([referencias](00-referencias.md)). La
PWA es más fácil de distribuir, pero:

- en iOS, el almacenamiento web puede borrarse y la PWA se suspende con más agresividad;
- no hay háptica en iOS Safari ni *keep-awake* fiable;
- el drag & drop táctil en la web compite con el scroll y los gestos del navegador.

La fiabilidad es la prioridad nº 3 y la velocidad la nº 1, así que **Expo nativo**.
El núcleo de dominio puro permitiría hacer más adelante un panel web (fase 3)
reutilizando la misma lógica.

## 1.3 Funcionamiento offline y autoguardado

- **No hay ninguna llamada de red en el código de partido.** Una regla de ESLint
  prohíbe importar el cliente de Supabase fuera de `src/sync/`.
- Cada evento (inicio, pausa, entrada, salida, cambio, descanso, segunda parte,
  final, movimiento, deshacer) se escribe **antes** de reflejarse en la UI.
- Al arrancar la app: `SELECT match WHERE status IN (running, paused, halftime)`.
  Si existe, se muestra el diálogo **"Hay un partido en curso · CONTINUAR"** y el
  estado se reconstruye desde los eventos; el reloj se recalcula con `Date.now()`.
- Fase 3: tabla `sync_outbox`; los eventos inmutables con UUIDv7 simplifican mucho
  la sincronización (solo inserciones e idempotencia por id).

## 1.4 Privacidad por diseño (RGPD, menores)

| Principio | Aplicación |
|-----------|------------|
| Minimización | Solo nombre, apellidos opcionales, dorsal, posición, portero, activo y foto opcional. **Sin** fecha de nacimiento, teléfono, email, dirección ni datos de salud |
| Nombre + inicial | Ajuste del equipo `displayNameMode: 'full' \| 'first_initial' \| 'first'` aplicado en toda la UI y en las exportaciones |
| Fotos | Opcionales, solo en el almacenamiento privado de la app y comprimidas. Nunca se suben a la nube salvo que se active expresamente (fase 3). Campo `photo_consent` |
| Sin perfiles públicos | No hay enlaces públicos ni rankings. Las estadísticas se ordenan por dorsal o por nombre, **nunca por minutos** por defecto |
| Exportar / compartir (fase 3) | El resumen compartible es solo del equipo; nada individual con foto |
| Derecho de supresión | Borrar a un jugador elimina su foto y su nombre; su histórico queda anonimizado ("Jugador #7") para no romper las estadísticas del equipo |
| Sin terceros | Sin SDKs de analítica ni de publicidad. Los informes de errores, si los hay, sin datos personales |
| Nube (fase 3) | Supabase en región UE, RLS por equipo, cifrado en tránsito y en reposo, registro de consentimiento de los tutores |
| Bloqueo opcional | PIN o biometría para abrir la app (fase 2) |

## 1.5 Extensibilidad (sin implementarla)

- `GameFormat` define: jugadores en campo, número de partes, duración por defecto,
  plantilla del campo (dimensiones y áreas) y tamaño máximo de convocatoria.
- `MatchEvent.type` es un enum abierto: goles, tarjetas, lesiones, cambio de portero
  y notas entran como nuevos tipos sin tocar el cálculo de minutos.
- `Team` → `Season` → `Match` permite tener varios equipos y temporadas desde el
  primer día (en el MVP la UI asume uno de cada).
- Todas las tablas tienen `created_at`, `updated_at`, `deleted_at` (borrado lógico)
  y `team_id` para la futura sincronización y la RLS.

## 1.6 Estructura del repositorio

```
minutos-futbol-base/
├── app/                         # Expo Router (solo pantallas y layout)
│   ├── _layout.tsx              # Proveedores, BD, comprobación de partido en curso
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx            # Partidos (inicio)
│   │   ├── squad.tsx            # Plantilla
│   │   └── settings.tsx         # Equipo / ajustes
│   ├── player/[id].tsx          # Alta / edición de jugador
│   ├── match/new/
│   │   ├── _layout.tsx          # Asistente de 3 pasos
│   │   ├── details.tsx
│   │   ├── squad.tsx            # Convocatoria
│   │   └── lineup.tsx           # Alineación inicial
│   └── match/[id]/
│       ├── live.tsx             # PANTALLA DE PARTIDO
│       └── summary.tsx          # Resumen final
├── src/
│   ├── core/                    # DOMINIO PURO (sin imports de RN / Expo)
│   │   ├── formats.ts           # GameFormat F7/F8/F11
│   │   ├── events.ts            # Tipos de MatchEvent
│   │   ├── reducer.ts           # events → MatchState
│   │   ├── projections.ts       # events → intervals, segments
│   │   ├── time.ts              # playedMs, matchClockMs, conversiones
│   │   ├── invariants.ts
│   │   ├── stats.ts             # Resumen de partido
│   │   └── __tests__/           # Unitarios + fast-check
│   ├── db/
│   │   ├── schema.ts            # Drizzle
│   │   ├── migrations/
│   │   ├── client.ts            # Apertura, PRAGMAs, integridad
│   │   └── repos/               # teamRepo, playerRepo, matchRepo, eventStore
│   ├── app-services/            # Casos de uso / comandos (cola serie)
│   ├── state/                   # Zustand: matchStore, clock
│   ├── features/
│   │   ├── live-match/          # Pitch, Bench, PlayerToken, DragLayer, ClockBar, UndoButton
│   │   ├── lineup/
│   │   ├── squad/
│   │   └── summary/
│   ├── ui/                      # Botones, tema claro/oscuro, tipografía
│   ├── sync/                    # FASE 3 (vacío en el MVP)
│   └── lib/                     # uuid, haptics, formato de tiempo
├── e2e/                         # Flujos Maestro
├── docs/
├── .github/workflows/ci.yml     # lint, typecheck, test
├── app.json / eas.json
└── package.json
```

`src/core` se puede extraer a un paquete de un monorepo cuando aparezca el panel
web (fase 3). Hacerlo ahora añadiría fricción de herramientas sin ningún beneficio.
