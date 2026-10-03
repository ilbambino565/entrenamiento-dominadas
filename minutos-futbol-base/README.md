# Minutos Fútbol Base

App móvil **local-first** para controlar en tiempo real los minutos de juego de cada
jugador de un equipo de fútbol base, moviendo jugadores con **drag & drop** entre
campo y banquillo. Sin cronómetros manuales: todo se calcula a partir de intervalos
con marcas de tiempo reales.

Prioridad: **VELOCIDAD > SIMPLICIDAD > FIABILIDAD > ESTADÍSTICAS**.

Formato inicial: fútbol 7. Arquitectura preparada para fútbol 8 y fútbol 11.

> Estado: **núcleo en construcción** (hitos M0-M2 del roadmap). Existe el dominio
> puro, la persistencia de la timeline, el motor del partido y el módulo de
> cámara desacoplado; todavía no hay pantallas de partido. El primer objetivo
> sigue siendo que el flujo `INICIAR PARTIDO → MOVER JUGADORES → CONTROLAR
> MINUTOS → FINALIZAR PARTIDO` sea completamente sólido antes de añadir nada más.

## Comandos

```bash
npm install
npm run verify            # tsc + fronteras entre módulos + tests
npm test                  # solo tests (Jest)
npm run typecheck
npm run check:boundaries  # core / camera / events / db no se mezclan
npx expo start            # app (de momento, pantalla de bienvenida)
```

## Documentación

| # | Documento | Contenido |
|---|-----------|-----------|
| 0 | [Referencias](docs/00-referencias.md) | Proyectos parecidos en GitHub y qué aprender de ellos |
| 1 | [Análisis y arquitectura](docs/01-arquitectura.md) | Análisis, stack, capas, offline, privacidad, estructura del repo |
| 2 | [Modelo de datos](docs/02-modelo-datos.md) | Entidades, esquema SQLite, invariantes |
| 3 | [Cronometraje](docs/03-cronometraje.md) | Estados, reloj, cálculo de minutos, deshacer, casos límite, anti-pérdida |
| 4 | [Drag & drop](docs/04-drag-and-drop.md) | Interacción, problemas previstos y soluciones |
| 5 | [Navegación y pantallas](docs/05-navegacion-pantallas.md) | Mapa de navegación y wireframes textuales |
| 6 | [Roadmap MVP](docs/06-roadmap.md) | Hitos, criterios de salida, fuera de alcance |
| 7 | [Cámara y timeline](docs/07-camara-y-timeline.md) | Timeline genérica, módulo de cámara desacoplado, sincronización futura con vídeo |

## Stack propuesto

React Native + Expo + TypeScript · Expo Router · expo-sqlite (WAL, migraciones
SQL) · Zustand · react-native-gesture-handler + Reanimated · Supabase (fase 3).
