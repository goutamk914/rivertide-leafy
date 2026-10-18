import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { cx } from './cx';

/** Hover waits this long before showing; keyboard focus shows instantly. */
export const TOOLTIP_HOVER_DELAY_MS = 800;

export interface TooltipProps {
  readonly content: ReactNode;
  readonly children: ReactElement;
  readonly placement?: 'above' | 'below' | 'right';
  /** Link the tooltip with aria-describedby. Off when it repeats the control's own label. */
  readonly describe?: boolean;
}

type Handler = ((event: SyntheticEvent) => void) | undefined;

/** Plain tooltip: 800 ms hover delay, instant on keyboard focus (never on click), Escape hides it. Never holds essential info. */
export function Tooltip({ content, children, placement = 'above', describe = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by pointerdown so the focus that follows a click doesn't open the tooltip. */
  const pressed = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isValidElement<Record<string, unknown>>(children)) return children;
  const chain = (own: Handler, next: () => void) => (event: SyntheticEvent) => {
    own?.(event);
    next();
  };
  const props = children.props;
  const trigger = cloneElement(children, {
    onPointerEnter: chain(props.onPointerEnter as Handler, () => {
      clear();
      timer.current = setTimeout(() => setOpen(true), TOOLTIP_HOVER_DELAY_MS);
    }),
    onPointerLeave: chain(props.onPointerLeave as Handler, () => {
      clear();
      setOpen(false);
    }),
    onFocus: chain(props.onFocus as Handler, () => {
      clear();
      if (pressed.current) {
        pressed.current = false;
        return;
      }
      setOpen(true);
    }),
    onBlur: chain(props.onBlur as Handler, () => {
      clear();
      setOpen(false);
    }),
    onPointerDown: chain(props.onPointerDown as Handler, () => {
      clear();
      pressed.current = true;
      setOpen(false);
    }),
    onPointerUp: chain(props.onPointerUp as Handler, () => {
      // Clicking an already-focused control fires no focus event; reset for the next keyboard focus.
      requestAnimationFrame(() => {
        pressed.current = false;
      });
    }),
    ...(describe ? { 'aria-describedby': open ? id : undefined } : {}),
  });

  return (
    <span className="rt-tooltip-anchor">
      {trigger}
      {open ? (
        <span id={id} role="tooltip" aria-hidden={describe ? undefined : true} className={cx('rt-tooltip', placement !== 'above' && `rt-tooltip--${placement}`)}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
