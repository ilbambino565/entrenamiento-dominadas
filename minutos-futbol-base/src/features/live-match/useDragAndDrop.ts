import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { MatchEngine } from '../../app-services/matchEngine';
import type { PlayerLocation } from '../../core';
import type { Point, Rect } from './geometry';
import { guarded, type Notify } from './guard';
import { haptics } from './haptics';
import {
  fieldTokenLayouts,
  resolveDrop,
  resolveTarget,
  type DropAction,
  type DropLayout,
  type DropOrigin,
  type DropTarget,
} from './resolveDrop';

/**
 * Arrastre y selección por toques de las fichas (docs/04).
 *
 * - `useDragAndDrop` vive en la pantalla: guarda las medidas de las zonas,
 *   el destino resaltado y la selección, y traduce cada acción de
 *   `resolveDrop` en un comando del motor (siempre envuelto en `guarded`).
 * - `useDraggableToken` vive en cada ficha: shared values del desplazamiento
 *   y un Gesture.Pan que activa por desplazamiento (≈ 8 dp, docs/04 §4.3
 *   nº 12): ni el banquillo ni la pantalla hacen scroll, así que no hay que
 *   proteger nada con una pulsación previa, y un toque de cualquier duración
 *   que no se mueva llega al `onPress` de la ficha (selección por toques).
 *   Solo habla con la pantalla por `scheduleOnRN` (el `runOnJS` de Reanimated 4)
 *   y la pantalla solo repinta cuando cambia el destino.
 *
 * Un único arrastre a la vez: `activeDrag` es un shared value que los
 * worklets consultan ANTES de levantar la ficha, así el segundo dedo no hace nada.
 */
export type HoverTarget =
  | { kind: 'token'; playerId: string }
  | { kind: 'pitch' }
  | { kind: 'bench' }
  /** Sobre el campo pero soltar NO hará nada (campo lleno): se avisa antes de levantar el dedo. */
  | { kind: 'rejected' }
  | null;

export interface DragController {
  /** Shared value con el id de la ficha arrastrada (null si ninguna). */
  activeDrag: SharedValue<string | null>;
  registerPitch(rect: Rect | null): void;
  registerBench(rect: Rect | null): void;
  beginDrag(playerId: string, from: PlayerLocation): void;
  updateDrag(point: Point): void;
  endDrag(point: Point): void;
  finalizeDrag(): void;
  /** Toque sobre una ficha: selecciona, deselecciona o ejecuta sobre ella. */
  tapToken(playerId: string): void;
  /** Toque en un punto absoluto (zona libre del campo); `fallback` si el campo aún no está medido. */
  tapPoint(point: Point, fallback?: DropTarget): void;
  /** Toque en un destino sin geometría (banquillo, o campo aún sin medir). */
  tapTarget(target: DropTarget): void;
}

export interface DragState {
  selectedId: string | null;
  draggingId: string | null;
  draggingFrom: PlayerLocation | null;
  hover: HoverTarget;
}

export const FIELD_FULL_MESSAGE = 'Suelta sobre un jugador para cambiar';
/** Tras un arrastre en web el navegador puede emitir un click: se ignora un instante. */
const TAP_SUPPRESS_MS = 300;
/** Desplazamiento mínimo para que un gesto sea arrastre (docs/04 §4.3 nº 12). */
export const MIN_DRAG_DISTANCE = 8;

const sameHover = (a: HoverTarget, b: HoverTarget): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind !== 'token' || b.kind !== 'token' || a.playerId === b.playerId));

function hoverFor(action: DropAction): HoverTarget {
  switch (action.kind) {
    case 'substitute':
      return { kind: 'token', playerId: action.outId };
    case 'swap':
      return { kind: 'token', playerId: action.b };
    case 'enter':
    case 'move':
      return { kind: 'pitch' };
    case 'rejected':
      return action.reason === 'FIELD_FULL' ? { kind: 'rejected' } : null;
    case 'leave':
    case 'reorder-bench':
      return { kind: 'bench' };
    default:
      return null;
  }
}

export function useDragAndDrop(engine: MatchEngine, notify: Notify): { controller: DragController; drag: DragState } {
  const zones = useRef<{ pitch: Rect | null; bench: Rect | null }>({ pitch: null, bench: null });
  const dragRef = useRef<DropOrigin | null>(null);
  const hoverRef = useRef<HoverTarget>(null);
  const selectedRef = useRef<string | null>(null);
  const suppressTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedState] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DropOrigin | null>(null);
  const [hover, setHoverState] = useState<HoverTarget>(null);
  const activeDrag = useSharedValue<string | null>(null);

  const setSelected = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedState(id);
  }, []);

  const setHover = useCallback((next: HoverTarget) => {
    if (sameHover(next, hoverRef.current)) return;
    hoverRef.current = next;
    setHoverState(next);
    // Sin tic al entrar en un destino que no hará nada: el tic significa "aquí sí".
    if (next && next.kind !== 'rejected') haptics.targetChanged();
  }, []);

  const layout = useCallback(
    (): DropLayout => ({
      pitch: zones.current.pitch,
      bench: zones.current.bench,
      tokens: fieldTokenLayouts(engine.getState(), zones.current.pitch),
    }),
    [engine],
  );

  const originOf = useCallback(
    (playerId: string): DropOrigin => ({ playerId, from: engine.getState().players[playerId]?.location ?? 'BENCH' }),
    [engine],
  );

  const execute = useCallback(
    async (action: DropAction) => {
      let ok: boolean;
      switch (action.kind) {
        case 'substitute':
          ok = await guarded(() => engine.substitute(action.inId, action.outId), notify, 'el cambio');
          break;
        case 'swap':
          ok = await guarded(() => engine.swapPlayers(action.a, action.b), notify, 'el intercambio');
          break;
        case 'enter':
          ok = await guarded(() => engine.enterPlayer(action.playerId, action.position), notify, 'la entrada');
          break;
        case 'move':
          ok = await guarded(() => engine.movePlayer(action.playerId, action.position), notify, 'el movimiento');
          break;
        case 'leave':
          ok = await guarded(() => engine.leavePlayer(action.playerId), notify, 'la salida');
          break;
        case 'rejected':
          if (action.reason === 'FIELD_FULL') {
            notify(FIELD_FULL_MESSAGE);
            haptics.error();
          }
          return;
        default:
          return;
      }
      if (ok) haptics.success();
      else haptics.error();
    },
    [engine, notify],
  );

  const beginDrag = useCallback(
    (playerId: string, from: PlayerLocation) => {
      dragRef.current = { playerId, from };
      setDragging(dragRef.current);
      setSelected(null);
      haptics.dragStart();
    },
    [setSelected],
  );

  const updateDrag = useCallback(
    (point: Point) => {
      const origin = dragRef.current;
      if (!origin) return;
      setHover(hoverFor(resolveDrop({ origin, point, layout: layout(), state: engine.getState() })));
    },
    [engine, layout, setHover],
  );

  const endDrag = useCallback(
    (point: Point) => {
      const origin = dragRef.current;
      if (!origin) return;
      void execute(resolveDrop({ origin, point, layout: layout(), state: engine.getState() }));
    },
    [engine, execute, layout],
  );

  const finalizeDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
    setHover(null);
    if (suppressTap.current) clearTimeout(suppressTap.current);
    suppressTap.current = setTimeout(() => {
      suppressTap.current = null;
    }, TAP_SUPPRESS_MS);
  }, [setHover]);

  const tapWith = useCallback(
    (resolve: (origin: DropOrigin) => DropAction) => {
      const selected = selectedRef.current;
      if (!selected) return;
      setSelected(null);
      void execute(resolve(originOf(selected)));
    },
    [execute, originOf, setSelected],
  );

  const tapToken = useCallback(
    (playerId: string) => {
      if (dragRef.current || suppressTap.current) return;
      const selected = selectedRef.current;
      if (!selected) {
        setSelected(playerId);
        return;
      }
      if (selected === playerId) {
        setSelected(null);
        return;
      }
      tapWith((origin) => resolveTarget(origin, { kind: 'token', playerId }, engine.getState()));
    },
    [engine, setSelected, tapWith],
  );

  const tapPoint = useCallback(
    (point: Point, fallback?: DropTarget) =>
      tapWith((origin) =>
        !zones.current.pitch && fallback
          ? resolveTarget(origin, fallback, engine.getState())
          : resolveDrop({ origin, point, layout: layout(), state: engine.getState() }),
      ),
    [engine, layout, tapWith],
  );

  const tapTarget = useCallback(
    (target: DropTarget) => tapWith((origin) => resolveTarget(origin, target, engine.getState())),
    [engine, tapWith],
  );

  useEffect(
    () => () => {
      if (suppressTap.current) clearTimeout(suppressTap.current);
    },
    [],
  );

  const controller = useMemo<DragController>(
    () => ({
      activeDrag,
      registerPitch: (rect) => {
        zones.current.pitch = rect;
      },
      registerBench: (rect) => {
        zones.current.bench = rect;
      },
      beginDrag,
      updateDrag,
      endDrag,
      finalizeDrag,
      tapToken,
      tapPoint,
      tapTarget,
    }),
    [activeDrag, beginDrag, updateDrag, endDrag, finalizeDrag, tapToken, tapPoint, tapTarget],
  );

  return {
    controller,
    drag: { selectedId, draggingId: dragging?.playerId ?? null, draggingFrom: dragging?.from ?? null, hover },
  };
}

/** Gesto y estilo animado de UNA ficha. El desplazamiento vive en el hilo UI. */
export function useDraggableToken(controller: DragController, playerId: string, from: PlayerLocation) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const lifted = useSharedValue(false);
  const { activeDrag, beginDrag, updateDrag, endDrag, finalizeDrag } = controller;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Por desplazamiento, no por pulsación: con `activateAfterLongPress` un
        // tirón rápido FALLA (se mueve antes del plazo) y una pulsación quieta
        // larga roba el toque al Pressable. Debajo del umbral el Pan falla al
        // soltar y el `onPress` de la ficha selecciona.
        .minDistance(MIN_DRAG_DISTANCE)
        .onStart(() => {
          // Otro dedo ya arrastra: este gesto no levanta nada.
          if (activeDrag.value !== null) return;
          activeDrag.value = playerId;
          lifted.value = true;
          scale.value = withSpring(1.1);
          scheduleOnRN(beginDrag, playerId, from);
        })
        .onUpdate((e) => {
          if (!lifted.value) return;
          tx.value = e.translationX;
          ty.value = e.translationY;
          scheduleOnRN(updateDrag, { x: e.absoluteX, y: e.absoluteY });
        })
        .onEnd((e) => {
          if (!lifted.value) return;
          // El dedo volvió casi al punto de partida: no era un arrastre. Sin
          // esto, con la propia ficha fuera del imán, saldría un "Mover" de 0 px.
          if (Math.hypot(e.translationX, e.translationY) < MIN_DRAG_DISTANCE) return;
          scheduleOnRN(endDrag, { x: e.absoluteX, y: e.absoluteY });
        })
        .onFinalize(() => {
          // Siempre vuelve a su sitio: el estado nuevo (si lo hay) ya la recoloca.
          if (lifted.value) {
            lifted.value = false;
            activeDrag.value = null;
            scheduleOnRN(finalizeDrag);
          }
          tx.value = withSpring(0);
          ty.value = withSpring(0);
          scale.value = withSpring(1);
        }),
    [activeDrag, beginDrag, updateDrag, endDrag, finalizeDrag, playerId, from, tx, ty, scale, lifted],
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return { pan, style };
}
