import { Fragment } from 'react';

interface KeysProps {
  readonly keys: readonly string[];
  readonly joiner?: '+' | 'then';
  /** `lg` draws lifted keycaps, `sm` inline keys for text and tables. */
  readonly size?: 'lg' | 'sm';
  readonly className?: string;
}

const SPOKEN: Record<string, string> = {
  '⌘': 'Command',
  '⇧': 'Shift',
  esc: 'Escape',
  ctrl: 'Control',
  shift: 'Shift',
};

/** A key combination. Screen readers hear "Command plus Shift plus Space"; everyone else sees keycaps. */
export function Keys({ keys, joiner = '+', size = 'sm', className }: KeysProps) {
  const spoken = keys.map((key) => SPOKEN[key] ?? key).join(joiner === 'then' ? ' then ' : ' plus ');
  const isPhrase = keys.length === 1 && keys[0].includes(' ');
  return (
    <span className={['rt-keys', `rt-keys--${size}`, className].filter(Boolean).join(' ')}>
      <span className="sr-only">{spoken}</span>
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 ? (
            <span className="rt-plus" aria-hidden="true">
              {joiner === 'then' ? 'then' : '+'}
            </span>
          ) : null}
          <kbd className={isPhrase ? 'rt-phrase' : size === 'lg' ? 'rt-key rt-key--cap' : 'rt-kbd'} aria-hidden="true">
            {key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
