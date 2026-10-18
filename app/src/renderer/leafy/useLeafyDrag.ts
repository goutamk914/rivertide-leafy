import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fireAndForget } from '../lib/hooks/bridge';
import { createClickGate, exceedsDragThreshold, windowOrigin, type Point } from './drag';

export interface LeafyDragOptions {
  readonly onClick: () => void;
  readonly onDoubleClick: () => void;
  /** Called after `leafy:dragEnd` was sent. */
  readonly onDrop: () => void;
}

interface Gesture {
  readonly pointerId: number;
  readonly start: Point;
  readonly grab: Point;
  readonly dragging: boolean;
}

/**
 * Press-and-drag to move Leafy's window (`leafy:moveTo`, one call per animation frame at most),
 * click to open the palette, double-click to talk. A press only becomes a drag after 4 px.
 */
export function useLeafyDrag({ onClick, onDoubleClick, onDrop }: LeafyDragOptions) {
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<Point | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onClick, onDoubleClick, onDrop });
  useEffect(() => {
    callbacks.current = { onClick, onDoubleClick, onDrop };
  });

  const gate = useMemo(
    () => createClickGate({ onSingle: () => callbacks.current.onClick(), onDouble: () => callbacks.current.onDoubleClick() }),
    [],
  );
  useEffect(() => () => {
    gate.dispose();
    cancelAnimationFrame(frame.current);
  }, [gate]);

  const flush = () => {
    frame.current = 0;
    const target = pending.current;
    pending.current = null;
    if (target) fireAndForget('leafy:moveTo', target);
  };

  const finish = (target: HTMLElement, pointerId: number, clicked: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    if (!current) return;
    if (current.dragging) {
      cancelAnimationFrame(frame.current);
      flush();
      fireAndForget('leafy:dragEnd', undefined);
      setDragging(false);
      callbacks.current.onDrop();
    } else if (clicked) {
      gate.click();
    }
  };

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      // Ctrl+click is the macOS context-menu gesture; the menu would swallow the pointerup.
      if (event.button !== 0 || event.ctrlKey) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.current = {
        pointerId: event.pointerId,
        start: { x: event.screenX, y: event.screenY },
        grab: { x: event.clientX, y: event.clientY },
        dragging: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        // The release happened somewhere we never heard about (e.g. a native menu): stop.
        finish(event.currentTarget, event.pointerId, false);
        return;
      }
      const point = { x: event.screenX, y: event.screenY };
      if (!current.dragging) {
        if (!exceedsDragThreshold(current.start, point)) return;
        gesture.current = { ...current, dragging: true };
        setDragging(true);
      }
      pending.current = windowOrigin(point, current.grab);
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      finish(event.currentTarget, event.pointerId, true);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      finish(event.currentTarget, event.pointerId, false);
    },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      finish(event.currentTarget, event.pointerId, false);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        callbacks.current.onClick();
      }
    },
  };

  return { dragging, handlers };
}
