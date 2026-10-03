import type { AnyNewMatchEvent } from '../core';
import type { AppBus, MatchEngine } from './matchEngine';

/**
 * Puente cámara → timeline. Es la ÚNICA pieza que conoce a los dos lados:
 * traduce los temas `camera.*` del bus a eventos `CAMERA_*` de la timeline
 * (source 'camera', timestamp el del propio evento del bus).
 *
 * Regla: la cámara nunca puede romper el partido ni al revés. Si el partido
 * aún no está cargado o la timeline rechaza el evento, se registra un aviso y
 * se sigue; el servicio de cámara ni se entera.
 */
export function createCameraTimelineBridge(bus: AppBus, engine: MatchEngine): () => void {
  const record = (input: AnyNewMatchEvent): void => {
    engine.recordExternalEvent(input).catch((error: unknown) => {
      console.warn(`[cameraTimelineBridge] ${input.type} no se registró en la timeline`, error);
    });
  };

  const subscriptions = [
    bus.on('camera.record.started', ({ recordingId, deviceType, timestamp }) =>
      record({ type: 'CAMERA_RECORDING_STARTED', timestamp, source: 'camera', metadata: { recordingId, deviceType } }),
    ),
    bus.on('camera.record.paused', ({ recordingId, timestamp }) =>
      record({ type: 'CAMERA_RECORDING_PAUSED', timestamp, source: 'camera', metadata: { recordingId } }),
    ),
    bus.on('camera.record.resumed', ({ recordingId, timestamp }) =>
      record({ type: 'CAMERA_RECORDING_RESUMED', timestamp, source: 'camera', metadata: { recordingId } }),
    ),
    bus.on('camera.record.stopped', ({ recordingId, timestamp }) =>
      record({ type: 'CAMERA_RECORDING_STOPPED', timestamp, source: 'camera', metadata: { recordingId } }),
    ),
    bus.on('camera.zone.changed', ({ zone, previousZone, timestamp }) =>
      record({ type: 'CAMERA_ZONE_CHANGED', timestamp, source: 'camera', metadata: { zone, previousZone } }),
    ),
  ];

  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
