import type { EventBus } from '../events/bus';
import type { MatchBusEventMap } from '../events/topics';
import type { CameraService } from './cameraService';

/** Solo los temas del reloj que usa: un bus con más temas (el de la app) también sirve. */
export type ClockBusEventMap = Pick<
  MatchBusEventMap,
  'match.started' | 'match.halftime' | 'match.period.started' | 'match.finished'
>;

/**
 * AUTOMATIZACIÓN DE LA GRABACIÓN SEGÚN EL RELOJ DEL PARTIDO.
 *
 * ESTÁ DORMIDA: en el MVP no se registra en ningún sitio. Nadie llama a
 * `createCameraAutomation`; `cameraSettings.autoRecord` es siempre false y la
 * cámara se maneja desde fuera de la app (modo `external`).
 *
 * Existe, con tests, para que el día que `autoRecord` sea true baste con
 * invocarla en la composición de la sesión del partido (createMatchSession):
 *
 *   match.started         → startRecording()
 *   match.halftime        → pauseRecording()   (sin capacidad de pausa: stopRecording)
 *   match.period.started  → resumeRecording()  (sin capacidad de pausa: startRecording)
 *   match.finished        → stopRecording()
 *
 * No conoce al MatchEngine: solo escucha el bus. Y como las operaciones del
 * servicio nunca lanzan ni bloquean, el reloj del partido no depende de la
 * cámara en ningún caso.
 */
export function createCameraAutomation(bus: EventBus<ClockBusEventMap>, service: CameraService): () => void {
  const canPause = (): boolean => service.getCapabilities()?.pause ?? true;

  const subscriptions = [
    bus.on('match.started', () => void service.startRecording()),
    bus.on('match.halftime', () => void (canPause() ? service.pauseRecording() : service.stopRecording())),
    bus.on('match.period.started', () => void (canPause() ? service.resumeRecording() : service.startRecording())),
    bus.on('match.finished', () => void service.stopRecording()),
  ];

  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
