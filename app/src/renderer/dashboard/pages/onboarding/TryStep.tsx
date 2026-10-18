import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, CircleCheck, Mic, Square } from 'lucide-react';
import type { VoiceSnapshot } from '@shared/types';
import { invoke, isElectron } from '../../../lib/ipc';
import { Button, Field, ICON_STROKE, TextArea } from '../../../ui/components';
import { useIpcEvent } from '../../hooks/useIpc';
import { moodForPhase, phaseLabel, useVoiceSnapshot } from '../../hooks/useVoice';
import { InlineError, StepFooter, StepHeader, useStepNav } from './step-frame';
import { StepLeafy } from './StepLeafy';
import { useAsyncAction } from './use-async-action';

/**
 * Practice dictation. Real pastes land in the focused box; the browser mock pastes nothing, so
 * outside Electron a finished dictation is copied into the empty box to stand in for the paste.
 */
function shouldSimulatePaste(snapshot: VoiceSnapshot, text: string): boolean {
  return !isElectron() && snapshot.phase === 'done' && snapshot.mode === 'dictate' && snapshot.output.length > 0 && text.trim() === '';
}

function statusWords(snapshot: VoiceSnapshot | null): string {
  if (snapshot?.phase === 'error' && snapshot.error) return snapshot.error.message;
  return phaseLabel(snapshot?.phase);
}

/** Cancels a practice session that is still listening when the person leaves this step. */
function useCancelOnLeave(listeningHere: RefObject<boolean>): void {
  useEffect(() => () => {
    // The step is gone, so there is no one to tell; a still-running session ends itself at max duration.
    if (listeningHere.current) void invoke('voice:cancel', undefined).catch(() => undefined);
  }, [listeningHere]);
}

export function TryStep() {
  const { goNext } = useStepNav();
  const snapshot = useVoiceSnapshot();
  const [text, setText] = useState('');
  const [sawSession, setSawSession] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const listeningHere = useRef(false);
  const start = useAsyncAction();
  const stop = useAsyncAction();
  useCancelOnLeave(listeningHere);

  useIpcEvent('voice:snapshot', (next) => {
    if (next.phase === 'done' && next.mode === 'dictate' && next.output.length > 0) setSawSession(true);
    if (next.phase !== 'listening') listeningHere.current = false;
    if (shouldSimulatePaste(next, text)) setText(next.output);
  });

  const practice = async () => {
    area.current?.focus();
    const started = await start.run(
      () => invoke('voice:start', { mode: 'dictate', source: 'dashboard' }),
      (detail) => `Rivertide couldn’t start listening. ${detail}`,
    );
    if (started?.phase !== 'listening') return;
    if (start.isMounted()) listeningHere.current = true;
    // The person left the step while the start was in flight: don't leave the mic open.
    else void invoke('voice:cancel', undefined).catch(() => undefined);
  };

  const finish = () => {
    area.current?.focus();
    void stop.run(() => invoke('voice:stop', undefined), (detail) => `Rivertide couldn’t stop listening. ${detail}`);
  };

  const succeeded = sawSession && text.trim().length > 0;
  const listening = snapshot?.phase === 'listening' && snapshot.source === 'dashboard';
  const error = start.error ?? stop.error;

  return (
    <>
      <StepHeader
        leading={<StepLeafy mood={succeeded ? 'success' : moodForPhase(snapshot?.phase)} label="Leafy" />}
        lede="Click in the box below, then hold fn and say something. Let go when you’re done."
      />
      <Field label="Practice here">
        <TextArea ref={area} rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <div className="onb-try">
        {listening ? (
          <Button variant="ghost" icon={Square} loading={stop.pending} onClick={finish}>
            I’m done talking
          </Button>
        ) : (
          <Button variant="ghost" icon={Mic} loading={start.pending} onClick={() => void practice()}>
            Practice without fn
          </Button>
        )}
        <p className="onb-try__status" role="status">
          <span className="onb-try__status-label">Status:</span> {statusWords(snapshot)}
        </p>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      <p className="onb-try__success" role="status">
        {succeeded ? (
          <>
            <CircleCheck size={18} strokeWidth={ICON_STROKE} aria-hidden />
            That worked. Rivertide wrote down what you said.
          </>
        ) : null}
      </p>
      <StepFooter
        primary={(
          <Button variant="accent" size="lg" iconEnd={ArrowRight} onClick={goNext}>
            {succeeded ? 'Continue' : 'Skip for now'}
          </Button>
        )}
      />
    </>
  );
}
