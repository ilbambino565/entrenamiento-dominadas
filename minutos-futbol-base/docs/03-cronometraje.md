# 3. Estados y lógica del cronometraje

Es la parte crítica. Regla de oro:

> **Nada se cuenta. Todo se calcula** a partir de marcas de tiempo reales guardadas
> en SQLite. `setInterval` solo sirve para repintar la pantalla una vez por segundo.

## 3.1 Estados del partido

```
           LINEUP_SET                  MATCH_STARTED
  DRAFT ─────────────▶ READY ──────────────────────────▶ RUNNING(p=1)
                                                           │   ▲
                                              MATCH_PAUSED │   │ MATCH_RESUMED
                                                           ▼   │
                                                         PAUSED(p)
                                                           │
                       HALFTIME_STARTED  (desde RUNNING o PAUSED; solo si p < nº partes)
                                                           ▼
                        PERIOD_STARTED                 HALFTIME
            RUNNING(p+1) ◀────────────────────────────────┘
                 │
                 │ MATCH_ENDED {NORMAL | SUSPENDED}  (desde RUNNING, PAUSED o HALFTIME)
                 ▼
             FINISHED
```

Los nombres son los de `src/core/events.ts`. `MATCH_STARTED` inicia el periodo
1 y `PERIOD_STARTED` cada periodo siguiente; así no hay dos eventos para el
mismo hecho.

- `periods_count` es configurable (2 partes; 4 cuartos si alguna federación lo usa).
- Botones visibles según el estado (solo el siguiente paso lógico, para reducir
  los toques):

| Estado | Botón principal | Secundario (pulsación larga o menú ⋯) |
|--------|-----------------|---------------------------------------|
| READY | **INICIAR** | — |
| RUNNING | **PAUSA** | DESCANSO (o FINALIZAR en la última parte) |
| PAUSED | **REANUDAR** | DESCANSO / FINALIZAR |
| HALFTIME | **2ª PARTE** | FINALIZAR (suspender) |
| RUNNING (última parte) | **PAUSA** | FINALIZAR |
| FINISHED | VER RESUMEN | Reabrir (deshacer el final) |

Las acciones destructivas (DESCANSO, FINALIZAR) piden **mantener pulsado 1 s** en
lugar de mostrar un diálogo de confirmación: es seguro y no hace falta leer.

## 3.2 Estados del jugador

| Estado | Significado | ¿Acumula? |
|--------|-------------|-----------|
| (no convocado) | No aparece en el partido | — |
| `BENCH` | En el banquillo | No |
| `ON_FIELD` | Intervalo abierto | **Solo si el reloj del partido está en marcha** |

`is_unavailable` (lesionado o expulsado) es un marcador visual, no un estado: el
jugador está en el banquillo.

## 3.3 Modelo temporal

Dos conjuntos de intervalos en tiempo real (epoch ms):

- **`ClockSegment`**: cuándo corre el reloj del partido (se abre con INICIAR,
  REANUDAR o 2ª PARTE; se cierra con PAUSA, DESCANSO o FINALIZAR).
- **`PlayerInterval`**: cuándo está un jugador en el campo. Se abre al pitido
  inicial (titulares) o al entrar y se cierra al salir o con FINALIZAR. **No se
  cierra en el descanso ni en las pausas.**

```
tiempo real ─────────────────────────────────────────────────────────▶
reloj       [=====1ª parte=====]  pausa  [==1ª==]   descanso  [====2ª parte====]
Lucas       [=========================]·········································· sale
Hugo                                   [====================================]  entra
Lucas jugó  = |Lucas ∩ reloj|   Hugo jugó = |Hugo ∩ reloj|
```

### Fórmulas (dominio puro)

```ts
type Span = { start: number; end: number | null }  // end null = abierto

const close = (s: Span, now: number) => s.end ?? now

function overlapMs(a: Span, b: Span, now: number): number {
  return Math.max(0, Math.min(close(a, now), close(b, now)) - Math.max(a.start, b.start))
}

/** Tiempo de juego de un jugador = Σ intervalos ∩ reloj en marcha */
function playedMs(intervals: Span[], segments: Span[], now: number): number {
  let total = 0
  for (const i of intervals) for (const s of segments) total += overlapMs(i, s, now)
  return total
}

/** Reloj del partido = Σ segmentos (de un periodo o de todos) */
const matchClockMs = (segments: Span[], now: number) =>
  segments.reduce((acc, s) => acc + (close(s, now) - s.start), 0)

/** Fracción jugada (0..1) respecto al tiempo REAL de partido transcurrido (incluye el añadido) */
const playedShare = (played: number, clock: number) => (clock <= 0 ? 0 : Math.min(1, played / clock))
```

Dos salvaguardas que viven en la fachada (`matchEngine.ts`), no en las
fórmulas: (1) el instante de consulta se acota a la última marca guardada, para
que con el reloj del sistema hacia atrás un intervalo abierto no se cierre
"antes" que un segmento ya cerrado; (2) `playerPlayedMs` une los tramos de un
mismo jugador que se solapen (solo posible si el reloj retrocedió entre salir y
volver a entrar), de modo que nadie suma más que el reloj.

Con 14 jugadores, unos 6 intervalos por jugador y unos 6 segmentos salen menos de
600 operaciones por segundo: despreciable.

### Consecuencias ventajosas

- **Pausa:** congela a todos los jugadores sin tocar sus intervalos.
- **Descanso:** el reloj se para y nadie acumula. Los cambios que se hagan en el
  descanso abren o cierran intervalos que no suman nada hasta la 2ª parte.
  Exactamente lo pedido.
- **Corregir el reloj** (por ejemplo, "el descanso empezó hace 3 minutos")
  recalcula automáticamente a todos los jugadores.
- **Móvil bloqueado o app cerrada:** al volver, `now = Date.now()` y todo es
  correcto, porque nada dependía de que la app estuviera viva.

### Visualización del reloj

- Grande: `23:42` acumulado del partido (convención: la 2ª parte empieza en 25:00).
- Pequeño: `1ª` / `2ª` / `DESCANSO` / `PAUSA` (parpadeo suave).
- Tiempo añadido: cuando el periodo supera su duración, `25:00 +1:23` y el reloj
  sigue. El % se calcula siempre sobre el tiempo real.

### Conversión tiempo de partido ↔ tiempo real

Para mostrar el minuto de un evento (`12:34`) y para corregirlo:

```ts
toMatchMs(ts)   = Σ segmentos ∩ (-∞, ts]
fromMatchMs(m)  = recorrer los segmentos acumulando hasta llegar a m → ts real
```

## 3.4 Bucle de UI

```ts
// Un solo "tick" global. NO cuenta nada: solo provoca el repintado.
useEffect(() => {
  const id = setInterval(() => clock.setNow(Date.now()), 1000)
  const sub = AppState.addEventListener('change', s => {
    if (s === 'active') clock.setNow(Date.now())   // recálculo inmediato al volver
  })
  return () => { clearInterval(id); sub.remove() }
}, [])
```

Cada tarjeta se suscribe con un selector a `now` y calcula su valor
(`playedMs(...)`). La tarjeta está memoizada y solo cambia el texto del tiempo.

## 3.5 Deshacer

- Pila LIFO de los eventos **de usuario no anulados** del partido (todos son
  deshacibles: cambio, entrada, salida, movimiento, pausa, descanso, inicio,
  final). Los eventos de cámara y de sistema no se deshacen desde aquí.
- `undo()` (implementado en `src/app-services/matchEngine.ts`):
  1. `markVoided(último evento de usuario no anulado)`
  2. regenerar el estado desde los eventos válidos (`reduceMatch`; con menos de
     300 eventos tarda menos de 5 ms)
  3. recalcular `matchTimeMs` / `period` de todos los eventos (`deriveEventFields`)
     y persistir los que cambien
  4. añadir `EVENT_UNDONE { targetEventId }` (informativo; se ignora al regenerar)
- Semántica: **como si la acción nunca hubiera ocurrido.** Si Hugo entró por error
  por Lucas en el 10:00 y se deshace en el 10:20, Hugo suma 0 y Lucas suma esos
  20 s, porque nunca salió.
- El botón **DESHACER** siempre está visible y muestra lo que va a deshacer
  (`↶ Hugo⇄Lucas`) para evitar deshacer algo distinto. La UI pasa el id de ese
  evento (`undo(at, expectedTargetId)`): si entre tanto entró otro gesto en la
  cola, el motor rechaza el deshacer y el rótulo se actualiza.
- Rutas de fallo: la anulación se escribe primero y la memoria se actualiza
  acto seguido; si fallan los campos derivados o el rastro `EVENT_UNDONE`, el
  deshacer sigue siendo un hecho (memoria == disco) y `load()` repara los
  derivados al volver a abrir.
- Se pueden encadenar varios deshacer. No hay "rehacer" en el MVP (simplicidad).
- Corregir eventos antiguos (no el último) se hace desde el historial (fase 2;
  el modelo ya lo permite cambiando `ts` y regenerando).

## 3.6 Casos límite

| Caso | Tratamiento |
|------|-------------|
| Entra y sale muchas veces | N intervalos; la suma es correcta por construcción |
| Sustitución accidental | DESHACER (anula el evento y regenera) |
| App cerrada o matada por el SO | Al abrir: "Hay un partido en curso · CONTINUAR"; estado = regenerar(eventos); reloj con `Date.now()` |
| Teléfono bloqueado varios minutos | Nada que hacer: el tiempo es una diferencia de timestamps. Recálculo en `AppState → active` |
| Cambio de 1ª a 2ª parte | `HALFTIME_STARTED` cierra el segmento; los intervalos siguen abiertos; `PERIOD_STARTED` abre un segmento nuevo |
| Olvido pulsar DESCANSO | Fase 2: al pulsarlo tarde se ofrecerá "Descanso · ajustar inicio −2 min" (corrección del `timestamp` del evento y regeneración; el modelo ya lo permite, falta el comando) |
| Tiempo añadido | El reloj no se para solo al llegar a 25:00: muestra `+mm:ss` y una vibración suave. El árbitro manda |
| Partido suspendido | `MATCH_ENDED{SUSPENDED}`; las estadísticas usan el tiempo real jugado; se marca como suspendido |
| Jugador lesionado | Arrastrar al banquillo (para su tiempo). Pulsación larga → 🩹 marcador; si se intenta meter, vibración de aviso (no se bloquea) |
| Expulsión | Igual que lesión, con 🟥; el campo se queda con 6 (está permitido: el límite es un máximo) |
| Llega tarde | Botón `+` del banquillo → lista de no convocados → `PLAYER_ADDED` |
| Titular planificado que finalmente no juega | "Titular" = en el campo al **pitido inicial** (derivado de `MATCH_STARTED`), no la planificación. Si se cambia antes de INICIAR, no consta como titular ni suma minutos |
| Convocado que no juega nada | Aparece en el resumen con 0:00 (convocado, no jugó) |
| Corrección posterior de un cambio | Editar el `ts` del evento (en minuto de partido) y regenerar. Se valida que no rompa invariantes |
| Dos cambios casi simultáneos | Cada gesto captura su `ts` al soltar. **Cola serie** de comandos: se aplican en orden; `seq` desempata en el mismo milisegundo |
| Cambios múltiples | N sustituciones seguidas (una por gesto). Fase 2: modo "cambio múltiple" que agrupa N cambios con un único `ts` |
| Cambio de portero | `GOALKEEPER_SET` (o sustitución sobre el portero, que hereda el rol). Queda registrado para los minutos de portero (fase futura) |
| Más de 7 en el campo | Se rechaza soltar en zona vacía con el campo lleno: rebote + "Suelta sobre un jugador para cambiar" |
| Dos dedos arrastrando | Solo se permite un arrastre activo a la vez |
| App en segundo plano a mitad de arrastre | Se cancela el arrastre (sin evento) |

## 3.7 Cómo evitar pérdida o corrupción de tiempos

1. **Fuente única e inmutable:** log `match_event` append-only. Las proyecciones son
   desechables.
2. **Una transacción por acción** (evento + proyecciones). SQLite en **WAL** con
   `synchronous=FULL`: lo confirmado sobrevive a un cierre forzoso o a que se
   acabe la batería.
3. **Escribir antes de mostrar:** la UI se actualiza después del `COMMIT` (son
   milisegundos; no se nota).
4. **Timestamp capturado en el gesto**, no al escribir, para que la cola no
   introduzca retrasos.
5. **Sin contadores acumulados** en ningún sitio: ni en memoria ni en la BD.
6. **Comprobación de integridad al abrir un partido:** regenerar las proyecciones y
   compararlas con las guardadas; si difieren, gana el log y se registra el aviso.
7. **Invariantes comprobadas** antes de cada `COMMIT`. Si una acción las violaría, se
   rechaza (no se guarda un estado imposible).
8. **Tests por propiedades (fast-check):** secuencias aleatorias de acciones +
   deshacer ⇒ invariantes siempre ciertas; `Σ minutos ≤ jugadores_en_campo × reloj`;
   deshacer(acción(estado)) == estado.
9. **Saltos del reloj del sistema** (cambio manual de hora o de zona horaria):
   guardar `last_clock_seen` en `app_meta`. Si `Date.now()` < último `ts` del
   partido, o hay un salto incoherente, se muestra un aviso y nunca se generan
   duraciones negativas (`max(0, …)`). Las zonas horarias no afectan porque todo es
   epoch ms.
10. **Copia de seguridad:** al finalizar se guarda un snapshot JSON del partido
    (eventos + resumen) en un archivo local. Exportable en fase 3.
11. **Migraciones versionadas** (SQL plano con `PRAGMA user_version`) y tests de
    migración contra un SQLite real.
12. **Prueba de campo obligatoria** antes de cerrar el MVP: matar la app, bloquear
    el móvil 10 minutos, modo avión, batería baja, cambiar la hora. Ver
    [roadmap](06-roadmap.md).
