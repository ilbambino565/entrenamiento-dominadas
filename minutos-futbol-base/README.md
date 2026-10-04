# Minutos Fútbol Base

App móvil **local-first** para controlar en tiempo real los minutos de juego de cada
jugador de un equipo de fútbol base, moviendo jugadores con **drag & drop** entre
campo y banquillo. Sin cronómetros manuales: todo se calcula a partir de intervalos
con marcas de tiempo reales.

Prioridad: **VELOCIDAD > SIMPLICIDAD > FIABILIDAD > ESTADÍSTICAS**.

Formato inicial: fútbol 7. Arquitectura preparada para fútbol 8 y fútbol 11.

> Estado: **plantilla real con persistencia en el dispositivo y partido con esa
> plantilla** (hitos M0-M3 y M5 del roadmap). Existen el dominio puro, la
> persistencia de la timeline, el motor del partido, el módulo de cámara
> desacoplado, el equipo y la plantilla (P2-P4) guardados en SQLite (en web, en
> memoria con copia en `localStorage`), un primer arranque mínimo (nombre del
> equipo o siembra desde un paquete de equipo) y una navegación provisional por
> pestañas (Partidos · Plantilla · Equipo) propia, sin Expo Router todavía
> (ver [doc 5](docs/05-navegacion-pantallas.md) §5.1). JUGAR PARTIDO abre el
> asistente (rival y fecha, convocatoria, alineación) y después la pantalla P8;
> el partido y su timeline se guardan en SQLite (en web, en `localStorage`).
> Al arrancar ofrece continuar un partido en curso (P0) y Partidos lista los
> recientes con su resumen (P1, hito M4 completo).

## Comandos

```bash
npm install
npm run verify            # tsc + fronteras entre módulos + tests
npm test                  # solo tests (Jest)
npm run test:props        # propiedades con 2 000 ejecuciones cada una (10 000 partidos)
npm run typecheck
npm run check:boundaries  # core / camera / events / db no se mezclan
npx expo start            # app (pestañas Partidos · Plantilla · Equipo y partido en vivo)
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
