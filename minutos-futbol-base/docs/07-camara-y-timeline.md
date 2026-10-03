# 7. Preparación para cámara/gimbal y timeline del partido

## 7.1 Punto de partida (análisis)

Cuando se pidió esta adaptación **no existía código**: solo los documentos
01-06. Por tanto no hay nada que "romper", pero sí una arquitectura diseñada que
había que respetar. La adaptación se ha hecho en dos planos:

1. **Diseño:** incorporar el módulo de cámara, el bus de eventos y la timeline
   genérica a la arquitectura (este documento y retoques en 01, 02 y 03).
2. **Código:** construir el núcleo que el diseño ya preveía (dominio puro,
   persistencia de eventos, motor del partido) **con** la timeline genérica y el
   módulo de cámara desde el primer día, en lugar de añadirlos después.

Lo que había diseñado encajaba bien con lo pedido:

| Pedido | Ya previsto en el diseño | Cambio |
|--------|--------------------------|--------|
| Timeline con timestamp preciso | `match_event` append-only con `ts` epoch ms | Se añaden `match_time_ms`, `period`, `player_id`, `secondary_player_id` como columnas; `payload` pasa a llamarse `metadata` |
| Modelo genérico de eventos | Sí (`type` + `payload`) | Se alinean los nombres a los pedidos (`MATCH_STARTED`, `PLAYER_ENTERED`...) |
| Separación MatchEngine / PlayerTimeTracker / EventTimeline | Capas aplicación / dominio / persistencia | Se nombran así los módulos |
| EventBus | No existía (el store de Zustand hacía de notificador) | Se añade `src/events` |
| CameraController, CameraState, CameraPanel, cameraSettings | No existía | Se añade `src/camera` y `src/features/camera` |
| Tablet | Diseño móvil "una mano" | Se anota: mismo diseño, más espacio; sin rediseñar ahora |

## 7.2 Mapa de módulos

```
src/
├── core/            DOMINIO PURO (sin React, sin Expo, sin cámara)
│   ├── events.ts        Timeline: modelo genérico MatchEvent (EventTimeline, tipos)
│   ├── state.ts         MatchState, ClockSegment, PlayerInterval, MatchRuleError
│   ├── reducer.ts       MatchEngine (parte pura): eventos → estado
│   ├── time.ts          PlayerTimeTracker: minutos = intervalos ∩ reloj en marcha
│   ├── derive.ts        Recalcula matchTimeMs/period de cada evento
│   ├── stats.ts         Resumen del partido
│   └── formats.ts       F7 / F8 / F11
├── events/          EventBus tipado + catálogo de temas
├── camera/          MÓDULO DE CÁMARA (no conoce jugadores ni cronómetro)
│   ├── types.ts         CameraController, CameraSettings, CameraStatus, CameraEventMap
│   ├── dummyCameraController.ts
│   ├── cameraStore.ts   CameraState (zustand vanilla)
│   ├── cameraService.ts Casos de uso: zonas, grabación; publica en el bus
│   ├── settings.ts      DEFAULT_CAMERA_SETTINGS / normalización
│   └── automation.ts    match.* → grabación (DORMIDA: no se registra en el MVP)
├── db/              EventStore (puerto) + InMemory + SQLite (expo-sqlite)
├── app-services/    MatchEngine (fachada con persistencia y bus) + puentes
│   ├── matchEngine.ts
│   ├── cameraTimelineBridge.ts   camera.* (bus) → eventos CAMERA_* en la timeline
│   └── createMatchSession.ts     Composición: engine + cámara + bus
├── features/camera/ CameraPanel y CameraStatusBadge (ocultos tras feature flag)
└── lib/             uuidv7, featureFlags
```

Fronteras (las comprueba `npm run check:boundaries`):

- `core` solo importa `core` y `lib`.
- `camera` solo importa `camera`, `events` y `lib`. **Nunca** `core`, `db` ni
  `app-services`.
- `events` puede importar tipos de `core` y `camera`.
- Nadie fuera de `sync/` importa Supabase.

## 7.3 Cómo se integra sin tocar la lógica del partido

```
                 comandos (UI)                       bus
  ┌──────────┐  substitute()  ┌─────────────┐  match.started  ┌──────────────────┐
  │ Pantalla │ ─────────────▶ │ MatchEngine │ ──────────────▶ │ (futuro)         │
  │ partido  │ ◀───────────── │  core+store │  player.entered │ CameraAutomation │
  └──────────┘   estado       └─────────────┘                 └────────┬─────────┘
                                     ▲                                 │ startRecording()
                                     │ recordExternalEvent(CAMERA_*)   ▼
                              ┌──────┴──────────┐  camera.record.* ┌───────────────┐
                              │ CameraTimeline  │ ◀─────────────── │ CameraService │
                              │ Bridge          │                  │  + Controller │
                              └─────────────────┘                  └───────────────┘
```

- **El MatchEngine no sabe que existe la cámara.** Solo publica en el bus y
  acepta "eventos externos" (`recordExternalEvent`) que se guardan en la
  timeline sin alterar el estado del partido ni los minutos.
- **La cámara no sabe que existe el partido.** Publica `camera.*` en el bus.
- **El puente** (`cameraTimelineBridge`) es la única pieza que conoce a ambos,
  y son 30 líneas: traduce `camera.record.started` → `CAMERA_RECORDING_STARTED`.
- **La automatización** (`match.started → startRecording()`) existe como
  función con tests pero **no se registra** en la composición: `autoRecord`
  es `false` y nada la llama.
- Si `cameraSettings` no existe, `createMatchSession` usa los valores por
  defecto (`enabled: false`, `mode: 'external'`), no se adjunta ningún
  controlador y toda operación de cámara es un no-op que devuelve `false`.

## 7.4 Modelo de evento (timeline)

```ts
interface MatchEvent {
  id: string              // UUIDv7
  matchId: string
  seq: number             // orden estricto; desempata timestamps iguales
  type: MatchEventType    // ver catálogo
  timestamp: number       // epoch ms REAL (la clave para el vídeo)
  matchTimeMs: number     // reloj de partido en ese instante (derivado)
  period: number          // 0 antes del pitido
  playerId: string | null
  secondaryPlayerId: string | null   // en SUBSTITUTION: el que sale
  metadata: ...           // tipado por `type`
  source: 'user' | 'system' | 'camera'
  voidedAt: number | null // DESHACER
}
```

Decisiones respecto a lo pedido:

- `matchTimeMs` en milisegundos en lugar de `matchTimeSeconds`: la precisión
  importa para cortar vídeo; convertir a segundos es trivial en la UI.
- `matchTimeMs` y `period` son **derivados** y se recalculan al regenerar (tras
  deshacer o corregir el reloj). El `timestamp` real nunca se recalcula.
- Los jugadores van en columnas propias (`playerId`, `secondaryPlayerId`), no
  dentro de `metadata`, para poder indexar "todas las intervenciones de Hugo".

### Catálogo

| Grupo | Tipos | ¿Afecta a minutos/estado? |
|-------|-------|----------------------------|
| Reloj | `MATCH_STARTED` `MATCH_PAUSED` `MATCH_RESUMED` `HALFTIME_STARTED` `PERIOD_STARTED` `MATCH_ENDED` | Sí |
| Jugadores | `LINEUP_SET` `PLAYER_ENTERED` `PLAYER_LEFT` `SUBSTITUTION` `PLAYER_MOVED` `PLAYERS_SWAPPED` `GOALKEEPER_SET` `PLAYER_ADDED` `PLAYER_UNAVAILABLE` | Sí |
| Juego (fase 2) | `GOAL` `ASSIST` `YELLOW_CARD` `RED_CARD` | No |
| Cámara | `CAMERA_RECORDING_STARTED` `_PAUSED` `_RESUMED` `_STOPPED` `CAMERA_ZONE_CHANGED` | No |
| Sistema | `EVENT_UNDONE` | No |

`MATCH_STARTED` inicia el periodo 1; `PERIOD_STARTED` inicia el 2 (o los
cuartos siguientes). Así no hay dos eventos para el mismo hecho.

## 7.5 Sincronización futura con vídeo

Con lo anterior, sincronizar es aritmética:

```
CAMERA_RECORDING_STARTED  timestamp = T0   (metadata.recordingId = R)
cualquier evento E        timestamp = Te
offset de E dentro del vídeo R  =  Te − T0  (+ corrección manual opcional)
```

Lo que podrá hacerse después **sin cambiar el modelo**:

| Función futura | Fuente de datos |
|----------------|-----------------|
| Ir desde la ficha de un jugador a sus momentos | `SELECT * FROM match_event WHERE match_id=? AND (player_id=? OR secondary_player_id=?)` |
| Clips de goles | Eventos `GOAL` ± N segundos |
| Ver solo las intervenciones de un jugador | Sus `PlayerInterval` (entrada → salida) convertidos a offsets de vídeo |
| Highlights / resumen | Lista ordenada de eventos de interés con offsets |
| Exportar timeline | La tabla `match_event` tal cual (JSON/CSV) |
| Varias grabaciones en un partido (pausa en el descanso) | Un `recordingId` por `CAMERA_RECORDING_STARTED`; cada evento se asigna a la grabación activa en su `timestamp` |

Pendiente (fuera del MVP): entidad `Recording` (`id`, `matchId`, `startedAt`,
`endedAt`, `fileUri`, `manualOffsetMs`) para enlazar con el archivo de vídeo.
El evento `CAMERA_RECORDING_STARTED` ya guarda lo necesario para crearla.

## 7.6 Modos de cámara

| Modo | Estado | Qué hace la app |
|------|--------|-----------------|
| `external` | **MVP** | Nada. La cámara y el gimbal se manejan con DJI Ronin + Force Mobile (móvil en el pecho del delegado). La app solo muestra "Control externo" |
| `zones` | Futuro | Botones IZQUIERDA / CENTRO / DERECHA (ampliables a `FAR_LEFT` / `FAR_RIGHT`) → `goToZone()` → `controller.goToPosition(zonaCalibrada, smoothTransitionMs)` y evento `CAMERA_ZONE_CHANGED` |
| `auto` | Reservado | Seguimiento por visión artificial. Sin implementar; el tipo existe para que la configuración no cambie |

## 7.7 Configuración por partido

```ts
cameraSettings?: {
  enabled: false,
  mode: 'external',
  deviceType: null,            // 'dummy' | 'dji_rsc2' | 'sony_a6600' | 'network'
  zones: { FAR_LEFT: null, LEFT: null, CENTER: null, RIGHT: null, FAR_RIGHT: null },
  smoothTransitionMs: 1500,
  zoomEnabled: false,
  autoRecord: false,           // la automatización nunca se activa en el MVP
}
```

Es opcional en todas partes: `normalizeCameraSettings(undefined)` devuelve los
valores por defecto. En SQLite se guardará como JSON en una columna
`camera_settings` de `match` (nullable) cuando exista esa tabla (hito M2).

## 7.8 UI en el MVP

- En los ajustes del partido, una fila: **Cámara · Modo: Externa / Force
  Mobile · Estado: Control externo**.
- Opcional, un distintivo pequeño `CAMERA ● EXTERNAL` (`CameraStatusBadge`),
  oculto por defecto.
- `CameraPanel` (zonas, REC / PAUSA / STOP, ZOOM −/+, RECENTER, indicadores de
  conexión y grabación) está construido y probado contra el
  `DummyCameraController`, pero **oculto** tras `FEATURE_FLAGS.cameraPanel =
  false`. No ocupa espacio en la pantalla de partido.

Prioridad intacta: jugadores, tiempos, cambios, cronómetro.

## 7.9 Lo que NO se ha hecho (a propósito)

SDK DJI, Bluetooth, API Sony, streaming, WebRTC, visión artificial, detección
de balón o jugadores, almacenamiento o edición de vídeo. Ninguna de esas piezas
requiere cambiar `core`, `db` ni `app-services`: entran como una nueva
implementación de `CameraController` y, en su momento, una entidad `Recording`.
