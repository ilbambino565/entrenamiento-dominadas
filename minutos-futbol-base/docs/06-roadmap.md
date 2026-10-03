# 6. Roadmap del MVP (fase 1)

Objetivo único: **INICIAR PARTIDO → MOVER JUGADORES → CONTROLAR MINUTOS →
FINALIZAR PARTIDO**, completamente sólido. Cada hito tiene criterios de salida;
no se pasa al siguiente sin cumplirlos.

| Hito | Contenido | Criterio de salida |
|------|-----------|--------------------|
| **M0 · Base** | Expo + TS estricto, Expo Router, ESLint/Prettier, Jest, CI (lint, typecheck, test), EAS dev build | CI verde; la app arranca en Android e iOS |
| **M1 · Núcleo de dominio** (sin UI) | `GameFormat`, tipos de evento, reducer, proyecciones, `playedMs`, reloj, deshacer, invariantes, `resolveDrop` | Cobertura > 95 % en `src/core`; tests de propiedades (fast-check) con más de 10 000 secuencias aleatorias sin violar invariantes; todos los casos límite del [doc 3](03-cronometraje.md#36-casos-límite) con un test |
| **M2 · Persistencia** | Esquema Drizzle, migraciones, EventStore (transacción por comando), cola serie, regeneración, comprobación de integridad, recuperación al arrancar | Test: matar el proceso entre comandos y recuperar el estado idéntico; regenerar == proyecciones |
| **M3 · Equipo y plantilla** | Primer arranque, P2, P3, P4 (lo mínimo: nombre, foto, dorsal, portero, activo, orden) | Crear un equipo de 14 jugadores en menos de 5 minutos |
| **M4 · Crear partido** | P5, P6, P7 (alineación con drag & drop; reutiliza los componentes de campo y banquillo) | Configurar un partido en menos de 60 s |
| **M5 · Partido en vivo** | P8: campo, banquillo, DragLayer, sustitución directa, reloj con estados, deshacer, háptica, keep-awake, P0 | E2E Maestro del flujo completo; 60 fps en un Android de gama baja |
| **M6 · Resumen** | P9: tabla, máx/mín/media, distribución, lista de cambios | Los minutos del resumen cuadran con un cálculo manual en un partido de prueba |
| **M7 · Endurecimiento** | Prueba de campo real (1-2 partidos en paralelo con una libreta), batería de pruebas de robustez, corrección de fallos, tema claro y oscuro | Ver la lista de abajo; cero diferencias superiores a 1 s frente al control manual |

### Batería de robustez (M7)

- [ ] Bloquear el móvil 10 minutos con el reloj en marcha y comprobar los tiempos al volver
- [ ] Forzar el cierre de la app en cada estado (READY, RUNNING, PAUSED, HALFTIME)
- [ ] Modo avión durante todo el partido
- [ ] Reiniciar el teléfono a mitad del partido
- [ ] Cambiar la hora del sistema a mitad del partido (debe avisar, no corromper)
- [ ] 40 cambios en un partido, incluidos dos casi simultáneos
- [ ] Deshacer 10 veces seguidas
- [ ] Cambios en el descanso
- [ ] Jugador que llega tarde, lesionado y expulsión
- [ ] Partido suspendido
- [ ] Batería por debajo del 5 % y apagado

## Fuera del MVP (no tocar hasta cerrar M7)

**Fase 2:** historial de partidos con corrección de eventos · estadísticas de
temporada · planificador de rotaciones y avisos discretos ("Lucas lleva 14' en el
banquillo") · plantillas de alineación · goles, tarjetas y notas · entrenamientos y
asistencia · PIN o biometría.

**Fase 3:** Supabase (auth, sync con outbox, RLS) · varios entrenadores, equipos y
temporadas en la UI · exportación PDF/CSV · compartir resumen de equipo por
WhatsApp · notificaciones · panel web.

### Nota sobre el planificador de rotaciones (fase 2)

Planteamiento previsto: `slots = jugadores_en_campo × duración`; objetivo por
jugador = `slots / convocados` (respetando el mínimo deseado y el portero fijo).
Se divide el partido en ventanas de cambio (por ejemplo, cada 6-8 minutos) y se
asigna con un voraz que da prioridad a quien menos acumula y más tiempo lleva en el
banquillo. Es **solo una recomendación**: no ejecuta nada. Durante el partido
recalcula con los minutos reales y alimenta los avisos discretos.

## Primeros pasos concretos (cuando se apruebe este diseño)

1. Crear el proyecto Expo (`create-expo-app --template` con TS y Router) y la CI.
2. Escribir `src/core/time.ts` y sus tests **antes** que cualquier pantalla.
3. Reducer y proyecciones con fast-check.
4. EventStore sobre expo-sqlite.
5. Pantalla P8 con datos de prueba (sin plantilla real) para validar el drag &
   drop en un dispositivo lo antes posible: es el mayor riesgo de UX.
