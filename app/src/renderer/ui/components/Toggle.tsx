import { useId, type ReactNode } from 'react';
import { cx } from './cx';

export interface ToggleProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** A switch: a real checkbox with role="switch", so keyboard and screen readers work natively. */
export function Toggle({ label, description, checked, onChange, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <label className={cx('rt-toggle', disabled && 'rt-toggle--disabled', className)} htmlFor={id}>
      <span className="rt-toggle__text">
        <span className="rt-toggle__label" id={`${id}-label`}>{label}</span>
        {description ? <span className="rt-toggle__description" id={`${id}-desc`}>{description}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="rt-toggle__input"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="rt-toggle__track" aria-hidden>
        <span className="rt-toggle__thumb" />
      </span>
    </label>
  );
}
