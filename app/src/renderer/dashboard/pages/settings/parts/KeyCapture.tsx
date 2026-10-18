import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { ICON_STROKE, Keys, cx } from '../../../../ui/components';
import { captureAccelerator, type Modifier, type Platform } from '../model/accelerator';

export interface KeyCaptureProps {
  readonly label: string;
  readonly description?: ReactNode;
  /** Electron accelerator; empty means the shortcut is off. */
  readonly value: string;
  readonly platform: Platform;
  readonly onChange: (accelerator: string) => void;
  /** Extra check (such as "already used") before saving; returns an error message or null. */
  readonly validate?: (accelerator: string) => string | null;
  /** Live registration status shown under the field. */
  readonly status?: ReactNode;
}

const CAPTURE_HINT = 'Hold the modifier keys, then press a key. Esc cancels. Delete turns the shortcut off.';

/**
 * Shortcut field: focusing it starts listening ("Press the new shortcut"); a valid combination is
 * saved straight away. Plain Tab still moves focus so keyboard users are never trapped.
 */
export function KeyCapture({ label, description, value, platform, onChange, validate, status }: KeyCaptureProps) {
  const id = useId();
  const [capturing, setCapturing] = useState(false);
  const [held, setHeld] = useState<readonly Modifier[]>([]);
  const [error, setError] = useState<string | null>(null);

  const stop = () => {
    setCapturing(false);
    setHeld([]);
  };

  const accept = (accelerator: string) => {
    const problem = accelerator ? validate?.(accelerator) ?? null : null;
    setError(problem);
    if (problem !== null) return;
    stop();
    if (accelerator !== value) onChange(accelerator);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return;
    const result = captureAccelerator(event, platform);
    if (result.kind === 'pass') return;
    event.preventDefault();
    event.stopPropagation();
    if (result.kind === 'cancel') {
      setError(null);
      stop();
    } else if (result.kind === 'clear') {
      accept('');
    } else if (result.kind === 'pending') {
      setHeld(result.modifiers);
    } else if (result.kind === 'invalid') {
      setError(result.message);
    } else {
      accept(result.accelerator);
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return;
    const result = captureAccelerator(event, platform);
    if (result.kind === 'pending') setHeld(result.modifiers);
  };

  return (
    <div className="settings-capture">
      <span id={`${id}-label`} className="rt-field__label">{label}</span>
      {description ? <p className="settings-row__description">{description}</p> : null}
      <button
        type="button"
        className={cx('settings-capture__field', capturing && 'settings-capture__field--active')}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-describedby={`${id}-message`}
        aria-invalid={error ? true : undefined}
        onFocus={() => setCapturing(true)}
        onClick={() => setCapturing(true)}
        onBlur={() => {
          stop();
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <span id={`${id}-value`} className="settings-capture__value">
          <CaptureValue capturing={capturing} held={held} value={value} platform={platform} />
        </span>
      </button>
      <div id={`${id}-message`} className={cx('rt-field__message', error && 'rt-field__message--error')} aria-live="polite">
        {error ? (
          <>
            <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden className="settings-icon-inline" />
            <span>{error}</span>
          </>
        ) : capturing ? (
          CAPTURE_HINT
        ) : (
          status
        )}
      </div>
    </div>
  );
}

function CaptureValue({ capturing, held, value, platform }: {
  readonly capturing: boolean;
  readonly held: readonly Modifier[];
  readonly value: string;
  readonly platform: Platform;
}) {
  if (capturing && held.length > 0) {
    return (
      <>
        <Keys keys={held.join('+')} platform={platform} />
        <span className="settings-capture__waiting">…</span>
      </>
    );
  }
  if (capturing) return <span className="settings-capture__prompt">Press the new shortcut</span>;
  if (!value) return <span className="settings-capture__off">Off</span>;
  return <Keys keys={value} platform={platform} />;
}
