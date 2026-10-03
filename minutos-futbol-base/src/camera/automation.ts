import type { EventBus } from '../events/bus';
import type { AppEventMap } from '../events/topics';
import type { CameraService } from './cameraService';

/** Mismo motivo que `CameraBusEventMap`: `AppEventMap` es una intersección de interfaces. */
export type AppBusEventMap = { [K in keyof AppEventMap]: AppEventMap[K] };

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
 *   match.halftime        → pauseRecording()
 *   match.period.started  → resumeRecording()
 *   match.finished        → stopRecording()
 *
 * No conoce al MatchEngine: solo escucha el bus. Y como las operaciones del
 * servicio nunca lanzan ni bloquean, el reloj del partido no depende de la
 * cámara en ningún caso.
 */
export function createCameraAutomation(bus: EventBus<AppBusEventMap>, service: CameraService): () => void {
  const subscriptions = [
    bus.on('match.started', () => void service.startRecording()),
    bus.on('match.halftime', () => void service.pauseRecording()),
    bus.on('match.period.started', () => void service.resumeRecording()),
    bus.on('match.finished', () => void service.stopRecording()),
  ];

  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
