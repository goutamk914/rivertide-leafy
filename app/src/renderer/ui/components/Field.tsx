import {
  createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, CircleAlert, type LucideIcon } from 'lucide-react';
import { ICON_STROKE } from './Button';
import { cx } from './cx';

interface FieldControl {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** Ids and ARIA wiring for a control placed inside <Field>. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  readonly label: ReactNode;
  /** Persistent help under the control; replaced by `error` when present. */
  readonly help?: ReactNode;
  readonly error?: string | null;
  readonly optional?: boolean;
  readonly required?: boolean;
  readonly className?: string;
  readonly id?: string;
  readonly children: ReactNode;
}

/** Label above, help or error below (stable height), ids wired to the child control. */
export function Field({ label, help, error, optional, required = false, className, id, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `${autoId}-control`;
  const messageId = `${autoId}-message`;
  const hasMessage = Boolean(error) || help !== undefined;
  const control: FieldControl = { id: controlId, describedBy: hasMessage ? messageId : undefined, invalid: Boolean(error), required };
  return (
    <div className={cx('rt-field', className)}>
      <label className="rt-field__label" htmlFor={controlId}>
        {label}
        {optional ? <span className="rt-field__optional">Optional</span> : null}
      </label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {/* Always mounted, so a new error is announced; the visible message below is linked via aria-describedby. */}
      <span className="visually-hidden" aria-live="polite">{error ?? ''}</span>
      {hasMessage ? (
        <div id={messageId} className={cx('rt-field__message', error && 'rt-field__message--error')}>
          {error ? (
            <>
              <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </>
          ) : (
            help
          )}
        </div>
      ) : null}
    </div>
  );
}

function controlProps(field: FieldControl | null, own: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; required?: boolean }) {
  return {
    id: own.id ?? field?.id,
    'aria-describedby': own['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': (own['aria-invalid'] as boolean | undefined) ?? (field?.invalid || undefined),
    'aria-required': own.required ?? field?.required ? true : undefined,
  };
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly leadingIcon?: LucideIcon;
  /** Right-edge slot: a clear button, a spinner, or a status icon. */
  readonly trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { leadingIcon: Lead, trailing, className, type = 'text', ...rest },
  ref,
) {
  const field = useFieldControl();
  return (
    <span className="rt-input-wrap">
      {Lead ? <span className="rt-input__lead"><Lead size={18} strokeWidth={ICON_STROKE} aria-hidden /></span> : null}
      <input
        ref={ref}
        type={type}
        className={cx('rt-input', Lead && 'rt-input--lead', trailing !== undefined && 'rt-input--trail', className)}
        {...rest}
        {...controlProps(field, rest)}
      />
      {trailing !== undefined ? <span className="rt-input__trail">{trailing}</span> : null}
    </span>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  const field = useFieldControl();
  return <textarea ref={ref} className={cx('rt-textarea', className)} {...rest} {...controlProps(field, rest)} />;
});

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** Native select (keeps full keyboard and screen-reader support) with a styled wrapper. */
export function Select<T extends string>({ options, value, onChange, className, ...rest }: SelectProps<T>) {
  const field = useFieldControl();
  return (
    <span className="rt-input-wrap rt-select-wrap">
      <select
        className={cx('rt-select', className)}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        {...rest}
        {...controlProps(field, rest)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="rt-input__trail"><ChevronDown size={18} strokeWidth={ICON_STROKE} aria-hidden /></span>
    </span>
  );
}
