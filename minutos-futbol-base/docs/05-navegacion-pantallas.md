# 5. Navegación y pantallas

## 5.1 Mapa de navegación (Expo Router)

```
Arranque
  └─ ¿Partido en curso? ──sí──▶ [Diálogo: Hay un partido en curso] ──CONTINUAR──▶ Partido en vivo
                         no
  ▼
Tabs ───────────────────────────────────────────────
 │  ⚽ Partidos (inicio)     👥 Plantilla     ⚙️ Equipo
 │      │                       │                │
 │      ├─ + Nuevo partido      └─ Jugador       └─ (nombre, escudo, colores,
 │      │     ├─ 1 Datos           (alta/edición)    categoría, temporada,
 │      │     ├─ 2 Convocatoria                      modo nombre, tema)
 │      │     └─ 3 Alineación ──INICIAR PARTIDO──▶ Partido en vivo (pantalla completa,
 │      │                                          sin tabs, gesto atrás desactivado)
 │      │                                               │ FINALIZAR
 │      │                                               ▼
 │      └─ Partido terminado ──────────────────────▶ Resumen
 │
 └─ Fase 2: 📊 Temporada · historial · rotaciones · entrenamientos
```

Primer arranque (sin equipo): asistente mínimo **Nombre del equipo → Formato
(F7) → Añadir jugadores** y luego la pestaña Partidos.

## 5.2 Pantallas del MVP

| # | Pantalla | Propósito | Interacciones clave |
|---|----------|-----------|---------------------|
| P0 | Partido en curso (diálogo) | Recuperación | CONTINUAR |
| P1 | Partidos | Inicio: próximo o en curso + lista | + Nuevo, abrir resumen |
| P2 | Plantilla | Listar, reordenar y activar jugadores | Arrastrar para ordenar, toque → editar |
| P3 | Jugador | Alta y edición | Foto, nombre, dorsal, portero |
| P4 | Equipo / ajustes | Personalización | Escudo, colores, tema |
| P5 | Nuevo partido · Datos | Rival, fecha, duración | 3 campos y continuar |
| P6 | Nuevo partido · Convocatoria | Seleccionar convocados | Toque para marcar |
| P7 | Nuevo partido · Alineación | Colocar titulares | Drag & drop, INICIAR PARTIDO |
| P8 | **Partido en vivo** | Gestión en tiempo real | Drag & drop, reloj, deshacer |
| P9 | Resumen | Minutos por jugador | Ver, (fase 2: compartir) |

## 5.3 Wireframes textuales

### P0 — Recuperación (diálogo modal al arrancar)

```
┌─────────────────────────────────┐
│                                 │
│     ⚽  Hay un partido en curso  │
│                                 │
│     vs CD Rival · 2ª parte      │
│     Reloj: 31:12 (en marcha)    │
│                                 │
│  ┌───────────────────────────┐  │
│  │    CONTINUAR PARTIDO      │  │  ← botón enorme
│  └───────────────────────────┘  │
│        Ver resumen / terminar   │  ← enlace pequeño
└─────────────────────────────────┘
```

### P1 — Partidos (inicio)

```
┌─────────────────────────────────┐
│ [escudo] CD Ejemplo · Alevín A  │
│          Temporada 2026/27      │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │  +  NUEVO PARTIDO           │ │  ← acción principal
│ └─────────────────────────────┘ │
│                                 │
│ Recientes                       │
│ ┌─────────────────────────────┐ │
│ │ sáb 27/09  vs CD Rival   ✓  │ │
│ │ sáb 20/09  vs UD Norte   ✓  │ │
│ │ sáb 13/09  vs AD Sur  susp. │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│   ⚽ Partidos  👥 Plantilla  ⚙️  │
└─────────────────────────────────┘
```

### P2 — Plantilla

```
┌─────────────────────────────────┐
│ Plantilla (14)          [ + ]   │
├─────────────────────────────────┤
│ ≡ (foto) #1  Mario G.   🧤      │
│ ≡ (foto) #5  Hugo P.            │
│ ≡ (foto) #7  Lucas M.           │
│ ≡ (foto) #9  Pablo R.           │
│ ≡ (  ? ) #11 Daniel S.  inactivo│  ← atenuado
│ ...                             │
│ ≡ = arrastrar para reordenar    │
├─────────────────────────────────┤
│   ⚽ Partidos  👥 Plantilla  ⚙️  │
└─────────────────────────────────┘
```

### P3 — Jugador

```
┌─────────────────────────────────┐
│ ←  Jugador               Guardar│
├─────────────────────────────────┤
│          ┌───────┐              │
│          │ FOTO  │  (tocar)     │
│          └───────┘              │
│  ☐ Tengo consentimiento foto    │
│                                 │
│  Nombre*     [ Hugo          ]  │
│  Apellidos   [ P.            ]  │
│  Dorsal      [ 5 ]              │
│  Posición    (POR)(DEF)(MED)(DEL)│
│  Portero     [  ○ ]             │
│  Activo      [ ●  ]             │
│                                 │
│  Eliminar jugador (anonimiza)   │
└─────────────────────────────────┘
```

### P4 — Equipo / ajustes

```
┌─────────────────────────────────┐
│ Equipo                          │
├─────────────────────────────────┤
│ [escudo]  Nombre [CD Ejemplo ]  │
│ Categoría   [ Alevín A      ]   │
│ Temporada   [ 2026/27       ]   │
│ Formato     (F7) (F8) (F11)     │
│ Duración parte por defecto [25] │
│ Colores     [■ primario][■ sec.]│
│ Mostrar nombres                 │
│   (● Nombre completo)           │
│   (○ Nombre + inicial)          │
│ Tema   (Auto)(Claro)(Oscuro)    │
│ Mantener pantalla encendida [●] │
└─────────────────────────────────┘
```

### P5 — Nuevo partido · 1 Datos

```
┌─────────────────────────────────┐
│ ←  Nuevo partido        1 / 3   │
├─────────────────────────────────┤
│ Rival*      [ CD Rival       ]  │
│ Fecha       [ sáb 04/10 10:00 ] │
│ Partes      [ 2 ] × [ 25 ] min  │
│                                 │
│ ▸ Más (opcional)                │
│     Local / Visitante           │
│     Competición  [          ]   │
│     Jornada      [          ]   │
│                                 │
│ ┌─────────────────────────────┐ │
│ │        CONVOCATORIA  →      │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### P6 — Nuevo partido · 2 Convocatoria

```
┌─────────────────────────────────┐
│ ←  Convocatoria   12 / 14  2/3  │
├─────────────────────────────────┤
│ [Todos] [Ninguno]               │
│ ☑ (foto) #1  Mario   🧤         │
│ ☑ (foto) #5  Hugo               │
│ ☑ (foto) #7  Lucas              │
│ ☐ (foto) #11 Daniel             │
│ ☑ (foto) #9  Pablo              │
│ ...  (toda la fila es tocable)  │
│ ┌─────────────────────────────┐ │
│ │        ALINEACIÓN  →        │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

Por defecto vienen marcados todos los activos (el caso más habitual es desmarcar 1
o 2).

### P7 — Nuevo partido · 3 Alineación

```
┌─────────────────────────────────┐
│ ←  Alineación     7 / 7    3/3  │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │      ┌─────────────┐        │ │
│ │          (#9)  (#10)        │ │
│ │                             │ │
│ │   (#7)     (#8)     (#11)   │ │
│ │                             │ │
│ │        (#4)    (#5)         │ │
│ │      └────(#1)─────┘        │ │
│ └─────────────────────────────┘ │
│ BANQUILLO                       │
│ (#3) (#6) (#12) (#14) (#2)      │
│                                 │
│ [Repetir última] [Auto 2-3-1]   │  ← atajos de colocación
│ ┌─────────────────────────────┐ │
│ │      INICIAR PARTIDO  ▶     │ │  ← activo con ≥1 en el campo
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

"INICIAR PARTIDO" lleva a P8 en estado READY: el reloj **no** arranca hasta pulsar
INICIAR en P8 (el árbitro pita cuando pita). Así se puede preparar todo minutos
antes.

### P8 — Partido en vivo (la pantalla importante)

```
┌─────────────────────────────────┐
│ vs CD Rival   1ª      ↶ DESHACER│  ← deshacer siempre visible
│               23:42             │  ← reloj grande (tiempo real calculado)
│ ┌───────────┐       Hugo⇄Lucas  │  ← qué deshará (texto pequeño)
│ │  PAUSA ❚❚ │   ⋯               │  ← botón contextual + menú (descanso/final)
│ └───────────┘                   │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ CAMPO          ┌───┐        │ │
│ │    ( foto)          ( foto) │ │
│ │     HUGO             PABLO  │ │
│ │     #5 18:20         #9 23:4│ │
│ │                             │ │
│ │ ( foto)    ( foto)   ( foto)│ │
│ │  LUCAS      MARCOS    ÁLEX  │ │
│ │  #7 23:42   #8 23:42  #11 12│ │
│ │                             │ │
│ │     ( foto)      ( foto)    │ │
│ │      IKER         LEO       │ │
│ │      #4 23:42     #6 23:42  │ │
│ │          ( foto)🧤          │ │
│ │           MARIO #1 23:42    │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ BANQUILLO                   [+] │  ← + = jugador que llega tarde
│ (foto)   (foto)   (foto)  (foto)│
│ DANI     RUBÉN    TONI    SAÚL  │
│ #3 5:22  #12 0:00 #14 11 #2 3:10│
│ ⏱8'      ⏱23'     ⏱12'    ⏱6'   │  ← tiempo seguido en el banquillo (discreto)
└─────────────────────────────────┘
```

Detalle de una ficha:

```
   ╭───────╮   ← anillo fino: % jugado frente al reparto equitativo
   │ FOTO  │      (tonos neutros: gris < 50 % del justo, azul ≈ justo, ámbar > 140 %)
   ╰───────╯      sin rojo/verde para no juzgar
    HUGO
  #5  18:20
     72%          ← tamaño pequeño; se puede ocultar en ajustes
```

Si no hay foto: círculo con el color del equipo y el dorsal grande (identificación
más rápida que una foto pequeña al sol).

Estados visuales:
- **PAUSA:** el reloj parpadea suavemente y aparece la etiqueta `PAUSA`.
- **DESCANSO:** banda superior `DESCANSO` y botón principal **2ª PARTE**. Los
  tiempos se quedan congelados y los cambios siguen permitidos.
- **Arrastrando:** destino resaltado, banquillo iluminado y el resto atenuado al 60 %.

Menú `⋯` (lo menos usado): Descanso · Finalizar · Suspender · Marcar lesionado ·
Ajustar reloj.

### P9 — Resumen del partido

```
┌─────────────────────────────────┐
│ ←  CD Ejemplo vs CD Rival       │
│    sáb 04/10 · 2×25 · 52:31 real│
├─────────────────────────────────┤
│ Jugador    Min    %   Ent. Tit. │
│ #1 Mario  52:31 100%   0   ●    │
│ #4 Iker   41:10  78%   1   ●    │
│ #5 Hugo   42:15  80%   2   ●    │
│ #7 Lucas  37:41  72%   2        │
│ #9 Pablo  29:13  56%   3        │
│ ...  (orden: dorsal, no minutos)│
├─────────────────────────────────┤
│ Máx 52:31 · Mín 18:02 · Media 34│
│ Distribución                    │
│ ▁▃▅▇▇▅▅▃▃▂▂▁  (barras por dorsal)│
├─────────────────────────────────┤
│ Cambios                         │
│ 12:34  ↓ Lucas  ↑ Hugo          │
│ 21:17  ↓ Pablo  ↑ Lucas         │
│ 31:02  ↓ Hugo   ↑ Mario         │
│ (fase 2: tocar para corregir)   │
└─────────────────────────────────┘
```

"Entradas" cuenta las veces que entró desde el banquillo (el titular no suma una
entrada por el pitido inicial).

## 5.4 Pautas de diseño

- **Una mano:** las acciones frecuentes (deshacer, reloj, banquillo) quedan en
  zonas alcanzables con el pulgar. Deshacer va arriba a la derecha para ser
  visible pero no pulsarse sin querer; se valorará moverlo abajo tras la prueba de
  campo.
- **Botones ≥ 56 dp**, tipografía tabular para los tiempos (no "baila").
- **Alto contraste** en el tema claro para el sol; tema oscuro para partidos de tarde.
- **Texto mínimo** en P8: nombres cortos (nombre o nombre + inicial), sin etiquetas
  explicativas.
- Orientación vertical bloqueada en el MVP.
