# 0. Proyectos parecidos en GitHub

Búsqueda realizada en octubre de 2026. Hay bastantes proyectos con la misma idea,
casi todos pequeños, de un solo autor, en inglés y pensados para fútbol recreativo
en EE. UU.

| Proyecto | Tipo | Qué aporta |
|----------|------|------------|
| [amcolosk/soccer-app-game-management](https://github.com/amcolosk/soccer-app-game-management) | TypeScript, activo (2026) | El más completo: plantilla, alineaciones, tiempo de juego, sustituciones y reparto equitativo. Merece la pena leer su modelo de datos |
| [SmithJohnTaylor/coach-sub-assistant](https://github.com/SmithJohnTaylor/coach-sub-assistant) | PWA offline | Datos solo en el dispositivo, igual que nuestro enfoque de privacidad |
| [jbudge3/team-sub](https://github.com/jbudge3/team-sub) | Web | "Quién está en el campo, quién descansa y desde cuándo": la misma información mínima que queremos en pantalla |
| [hudelson42/everyone-plays](https://github.com/hudelson42/everyone-plays) | Un solo HTML | Ni cuenta ni cobertura: simplicidad extrema |
| [Is1d0re/GameTimeTracker](https://github.com/Is1d0re/GameTimeTracker) | App | Reparto equitativo automático y funcionamiento offline |
| [dbugger85/substitutor](https://github.com/dbugger85/substitutor) | Web | "Cambios justos" en fútbol infantil |
| [jdmax/soccer-timer](https://github.com/jdmax/soccer-timer) | PWA | Se instala en la pantalla de inicio y funciona sin cobertura |
| [leeessner/soccer-tracker](https://github.com/leeessner/soccer-tracker) | PWA + nube | Offline con sincronización: lo que haremos en la fase 3 |
| [rbynfnch/soccer-subs](https://github.com/rbynfnch/soccer-subs) | HTML | Seguimiento de tiempo y cambios |
| [jasonbahl/footyboard](https://github.com/jasonbahl/footyboard) | Next.js + WordPress | Gestión visual del campo y cambios en tiempo real (depende del servidor) |
| [conoromahony/soccer_lineup](https://github.com/conoromahony/soccer_lineup) | Python | Planificador de cambios para repartir minutos (útil para la fase 2) |
| [term5-projects/CoachOMatic_Maven](https://github.com/term5-projects/CoachOMatic_Maven) | Java (escritorio) | Generador de alineaciones con tiempo equitativo |

## Conclusiones

1. **El problema está validado.** Muchos entrenadores se han hecho su propia
   herramienta, así que la necesidad existe.
2. **Ninguno reúne todo lo que pedimos:** campo visual con drag & drop libre,
   sustitución directa soltando un jugador sobre otro, minutos calculados a partir
   de intervalos que se pueden corregir, deshacer, app nativa local-first, interfaz
   en español y formatos F7/F8/F11.
3. **Casi todos son PWA.** Es una opción válida y más barata de distribuir, pero en
   iOS la PWA tiene limitaciones: el almacenamiento puede borrarse, no hay háptica
   y no hay *keep-awake* fiable. Mantenemos **Expo nativo** como primera opción
   (ver [arquitectura](01-arquitectura.md#por-qué-expo-y-no-una-pwa)).
4. **Recomendación:** no hacer un fork. Revisar `amcolosk/soccer-app-game-management`
   y `coach-sub-assistant` como inspiración (comprobando su licencia antes de
   reutilizar nada) y construir nuestro propio núcleo de cronometraje, que es la
   parte crítica y donde está la diferencia.
