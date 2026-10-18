import type { ReactNode } from 'react';
import { acceleratorToKeys, acceleratorToSpeech } from '../../lib/format';
import { cx } from './cx';

export interface KbdProps {
  readonly children: ReactNode;
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}

/** One keycap. */
export function Kbd({ children, size = 'md', className }: KbdProps) {
  return <kbd className={cx('rt-kbd', size === 'lg' && 'rt-kbd--lg', className)}>{children}</kbd>;
}

export interface KeysProps {
  /** Electron accelerator ("CommandOrControl+Shift+Space") or a list of key labels. */
  readonly keys: string | readonly string[];
  readonly platform?: 'darwin' | 'win32' | 'linux';
  readonly size?: 'md' | 'lg';
}

/** A key combination as keycaps, announced as words ("Command Shift Space"). */
export function Keys({ keys, platform = 'darwin', size }: KeysProps) {
  const list = typeof keys === 'string' ? acceleratorToKeys(keys, platform) : keys;
  const spoken = typeof keys === 'string' ? acceleratorToSpeech(keys, platform) : keys.join(' ');
  return (
    <span className="rt-keys" role="img" aria-label={spoken}>
      {list.map((key, i) => (
        <Kbd key={`${key}-${i}`} size={size}>
          {key}
        </Kbd>
      ))}
    </span>
  );
}
