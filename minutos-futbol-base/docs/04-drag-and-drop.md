# 4. Drag & drop: interacción y problemas previstos

## 4.1 Gestos y su significado

| Origen → destino | Resultado | Evento |
|------------------|-----------|--------|
| Banquillo → zona vacía del campo | Entra (si hay sitio) | `PLAYER_IN` |
| Banquillo → jugador del campo | **Sustitución directa** | `SUBSTITUTION` |
| Campo → banquillo | Sale | `PLAYER_OUT` |
| Campo → zona vacía del campo | Se recoloca | `MOVE` |
| Campo → otro jugador del campo | Intercambian posiciones | `SWAP_ON_FIELD` |
| Banquillo → banquillo | Reordenar el banquillo (sin evento de tiempo) | — |
| Soltar fuera de cualquier zona | Cancelar: vuelve a su sitio | — |

Antes del pitido los mismos gestos editan la alineación (no hay intervalos).

**Alternativa sin arrastrar (fiabilidad):** tocar un jugador lo selecciona (borde
resaltado) y tocar el destino ejecuta la misma acción. Es útil con guantes, con
lluvia o cuando el arrastre falla.

## 4.2 Implementación

- **react-native-gesture-handler (Pan) + Reanimated:** el arrastre corre en el hilo
  UI a 60 fps aunque JS esté ocupado.
- **Capa de arrastre única (`DragLayer`)** a pantalla completa por encima del campo y
  del banquillo. Al empezar el arrastre, la ficha se "despega" y se dibuja en esa
  capa. Así se evita el problema de `zIndex` / `overflow` entre contenedores (el
  banquillo con scroll recortaría la ficha).
- **Destinos registrados** con sus rectángulos absolutos (`measure()` en
  `onLayout`, recalculados al rotar o cambiar el tamaño). La detección del destino
  se hace en un worklet con el centro de la ficha.
- **Imán:** si el centro queda a menos de R (≈ 0,6 × diámetro de la ficha) de un
  jugador del campo, el destino es ese jugador (sustitución o intercambio); si no,
  es una posición libre.
- **Feedback previo al soltar:** el jugador destino se resalta (anillo + etiqueta
  `⇄`) y el banquillo se ilumina si es el destino. El usuario sabe qué va a pasar
  **antes** de levantar el dedo.
- **Háptica:** tic al empezar, tic al cambiar de destino y confirmación al soltar
  con éxito; patrón de error al rechazar.
- Las acciones se envían a la **cola serie de comandos** con el `ts` del momento de
  soltar.

## 4.3 Problemas previstos y soluciones

| # | Problema | Solución |
|---|----------|----------|
| 1 | **Conflicto con el scroll** del banquillo (deslizar ≠ arrastrar) | Con ≤ 9 suplentes se usan **dos filas sin scroll**, así que no hay conflicto y el arrastre se activa **por desplazamiento (≈ 8 dp, ver nº 12)**, nunca por pulsación previa: una pulsación quieta debe seguir siendo un toque (selección) y un tirón rápido debe arrastrar. Si algún día hubiera scroll: `activeOffsetY` / `failOffsetX` |
| 2 | **Gesto "atrás" del sistema** al arrastrar desde el borde (iOS/Android) | Margen lateral en el campo; desactivar el gesto atrás en la pantalla de partido |
| 3 | **Soltar sobre el jugador equivocado** cuando hay fichas juntas | Imán con resaltado previo; colisión suave que separa fichas solapadas al soltar; tamaño de ficha ≥ 56 dp |
| 4 | **Sustitución accidental** | DESHACER siempre visible con descripción de lo que deshace; háptica distinta para cambio y movimiento |
| 5 | **Campo lleno** al soltar en zona vacía | Rebote animado + mensaje breve "Suelta sobre un jugador"; no se guarda nada |
| 6 | **Drop ambiguo** en la frontera entre campo y banquillo | Franja muerta de 12 dp entre zonas; el destino resaltado es el que se aplica |
| 7 | **Multitouch** (dos fichas a la vez) | Un solo arrastre activo (`simultaneousHandlers` desactivado; bloqueo global) |
| 8 | **Interrupción** (llamada, bloqueo, notificación) a mitad de arrastre | `onFinalize` / `AppState` cancela y devuelve la ficha; nunca se genera un evento parcial |
| 9 | **Rendimiento:** el tick de 1 s re-renderiza 14 tarjetas mientras se arrastra | Tarjetas memoizadas; solo el texto del tiempo se suscribe a `now`; la posición arrastrada vive en shared values (sin re-render de React) |
| 10 | **Coordenadas dependientes del tamaño de pantalla** | Las posiciones se guardan normalizadas (0..1) respecto al campo; se adaptan a cualquier móvil y a la orientación |
| 11 | **Medidas obsoletas** tras rotar, teclado o cambio de layout | Volver a medir en `onLayout`; bloquear la orientación en vertical en el MVP |
| 12 | **Toque fallido (tap) vs arrastre corto** | Umbral de movimiento (≈ 8 dp) para considerar arrastre; por debajo es selección por toque |
| 13 | **Luz solar / dedos mojados** | Alto contraste, fichas grandes, alternativa por toques |
| 14 | **Accesibilidad** (lectores de pantalla) | Acciones accesibles por jugador: "Meter en el campo", "Sacar", "Cambiar por…" |
| 15 | **Scroll de la página** mientras se arrastra | La pantalla de partido no tiene scroll vertical: todo cabe en una pantalla |

## 4.4 Tests específicos

- Unitarios de la función pura `resolveDrop(origin, point, layout, state) → Action`
  con tablas de casos (bordes, imán, campo lleno).
- E2E con Maestro: arrastres reales en emulador (banquillo → jugador, campo →
  banquillo, deshacer).
- Prueba manual en un dispositivo Android de gama baja (el peor caso de rendimiento).
