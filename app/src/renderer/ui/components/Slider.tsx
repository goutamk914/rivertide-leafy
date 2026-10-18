import { useId, useRef, type CSSProperties, type ReactNode } from 'react';

export interface SliderProps {
  readonly label: ReactNode;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  /** Called when the user lets go (pointer up / key up): a good moment to save. */
  readonly onCommit?: (value: number) => void;
  readonly format?: (value: number) => string;
  readonly minLabel?: string;
  readonly maxLabel?: string;
  readonly disabled?: boolean;
  readonly help?: ReactNode;
}

/** Native range input (keyboard + screen reader friendly) with a 44 px tall hit area. */
export function Slider({ label, value, min, max, step, onChange, onCommit, format = String, minLabel, maxLabel, disabled, help }: SliderProps) {
  const id = useId();
  const fill = `${((value - min) / (max - min)) * 100}%`;
  /** The value as of the last commit (or focus), so Tab key-ups and plain clicks never save. */
  const committed = useRef(value);
  const commit = (event: { currentTarget: HTMLInputElement }) => {
    const next = Number(event.currentTarget.value);
    if (next === committed.current) return;
    committed.current = next;
    onCommit?.(next);
  };
  return (
    <div className="rt-slider">
      <div className="rt-slider__head">
        <label className="rt-field__label" htmlFor={id}>{label}</label>
        <output className="rt-slider__value" htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        className="rt-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={help ? `${id}-help` : undefined}
        style={{ '--fill': fill } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        onFocus={() => {
          committed.current = value;
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {minLabel || maxLabel ? (
        <div className="rt-slider__scale" aria-hidden>
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
      {help ? <div id={`${id}-help`} className="rt-field__message">{help}</div> : null}
    </div>
  );
}
