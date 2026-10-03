# Minutos Fútbol Base

App móvil **local-first** para controlar en tiempo real los minutos de juego de cada
jugador de un equipo de fútbol base, moviendo jugadores con **drag & drop** entre
campo y banquillo. Sin cronómetros manuales: todo se calcula a partir de intervalos
con marcas de tiempo reales.

Prioridad: **VELOCIDAD > SIMPLICIDAD > FIABILIDAD > ESTADÍSTICAS**.

Formato inicial: fútbol 7. Arquitectura preparada para fútbol 8 y fútbol 11.

> Estado: **fase de diseño**. Aún no hay código. El primer objetivo es que el flujo
> `INICIAR PARTIDO → MOVER JUGADORES → CONTROLAR MINUTOS → FINALIZAR PARTIDO`
> sea completamente sólido antes de añadir nada más.

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

## Stack propuesto

React Native + Expo + TypeScript · Expo Router · expo-sqlite (WAL) + Drizzle ·
Zustand · react-native-gesture-handler + Reanimated · Supabase (fase 3).
