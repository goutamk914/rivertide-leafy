import { useState } from 'react';
import { Check, CircleAlert, PlugZap } from 'lucide-react';
import type { ProviderTestResult } from '@shared/ipc';
import { errorMessage, invoke } from '../../../../lib/ipc';
import { Button, ICON_STROKE, cx } from '../../../../ui/components';
import { testResultText } from '../model/settings-model';

export interface ProviderTestProps {
  readonly kind: 'llm' | 'stt';
  readonly providerId: string;
  /** Provider name, used in the button's accessible name ("Test Groq connection"). */
  readonly name: string;
}

interface TestState {
  readonly pending: boolean;
  readonly result: ProviderTestResult | null;
}

/** "Test" button with a live result line: "Connected · 412 ms" or main's plain error message. */
export function ProviderTest({ kind, providerId, name }: ProviderTestProps) {
  const [state, setState] = useState<TestState>({ pending: false, result: null });

  const run = async () => {
    setState((s) => ({ ...s, pending: true }));
    try {
      const result = await invoke('providers:test', { kind, providerId });
      setState({ pending: false, result });
    } catch (error) {
      setState({ pending: false, result: { ok: false, latencyMs: null, message: `The test didn’t run. ${errorMessage(error)}` } });
    }
  };

  const { result } = state;
  return (
    <div className="settings-test">
      <Button size="sm" icon={PlugZap} loading={state.pending} aria-label={`Test ${name} connection`} onClick={() => void run()}>
        Test
      </Button>
      <p className={cx('rt-status', result && (result.ok ? 'rt-status--success' : 'rt-status--error'))} role="status" aria-live="polite">
        {result ? (
          <>
            {result.ok ? (
              <Check size={16} strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden className="settings-icon-inline" />
            )}
            <span>{testResultText(result)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
