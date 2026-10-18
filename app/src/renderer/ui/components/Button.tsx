import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

export const ICON_STROKE = 1.75;

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'quiet' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner in place of the icon and blocks clicks; the label stays readable. */
  readonly loading?: boolean;
  readonly icon?: LucideIcon;
  readonly iconEnd?: LucideIcon;
  readonly block?: boolean;
}

export function Spinner({ label }: { readonly label?: string }) {
  return <span className="rt-spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', loading = false, icon: Icon, iconEnd: IconEnd, block, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 20 : 18;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('rt-btn', `rt-btn--${variant}`, size !== 'md' && `rt-btn--${size}`, block && 'rt-btn--block', className)}
      aria-busy={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner /> : Icon ? <span className="rt-btn__icon"><Icon size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /></span> : null}
      {children}
      {IconEnd && !loading ? <span className="rt-btn__icon"><IconEnd size={iconSize} strokeWidth={ICON_STROKE} aria-hidden /></span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Required: the accessible name, also shown as a tooltip. */
  readonly label: string;
  readonly icon: LucideIcon;
  readonly size?: 'sm' | 'md';
  readonly variant?: 'ghost' | 'plain' | 'danger';
  readonly tooltip?: boolean;
  readonly tooltipPlacement?: 'above' | 'below' | 'right';
  readonly badge?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, size = 'md', variant = 'ghost', tooltip = true, tooltipPlacement = 'above', className, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx('rt-icon-btn', size === 'sm' && 'rt-icon-btn--sm', variant !== 'ghost' && `rt-icon-btn--${variant}`, className)}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 18} strokeWidth={ICON_STROKE} aria-hidden />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} placement={tooltipPlacement} describe={false}>
      {button}
    </Tooltip>
  );
});
