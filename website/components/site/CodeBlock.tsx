'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const COPIED_MS = 1800;

/** Terminal commands with a copy button. If the clipboard is unavailable, the text stays selectable. */
export function CodeBlock({ lines, label }: { readonly lines: readonly string[]; readonly label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = window.setTimeout(() => setState('idle'), COPIED_MS);
  };

  return (
    <div className="code">
      <div className="code__bar">
        <span className="code__label">Terminal</span>
        <button type="button" className="code__copy" onClick={copy}>
          {state === 'copied' ? <Check size={15} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={15} strokeWidth={1.75} aria-hidden="true" />}
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
        </button>
      </div>
      <pre className="code__pre" aria-label={label}>
        <code>{lines.join('\n')}</code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Commands copied to the clipboard.' : state === 'failed' ? 'Could not copy. Select the text and copy it instead.' : ''}
      </span>
    </div>
  );
}
