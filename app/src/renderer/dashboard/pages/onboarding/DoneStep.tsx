import { navigate } from '../../../lib/router';
import { PAGE_TITLE_ID } from '../../shell/Page';
import { Button } from '../../../ui/components';
import { useUpdateSettings } from '../../state/settings-store';
import { InlineError, StepFooter, StepHeader } from './step-frame';
import { StepLeafy } from './StepLeafy';
import { useAsyncAction } from './use-async-action';

export function DoneStep() {
  const update = useUpdateSettings();
  const finish = useAsyncAction();

  const open = async () => {
    const done = await finish.run(async () => {
      if (!(await update({ onboarded: true }))) throw new Error('The save didn’t go through.');
      return true;
    }, () => 'Rivertide couldn’t finish setup. Try again in a moment.');
    if (!done || !finish.isMounted()) return;
    navigate('/');
    // The shell skips focus on its first render; land keyboard users on the new page's title.
    requestAnimationFrame(() => document.getElementById(PAGE_TITLE_ID)?.focus({ preventScroll: true }));
  };

  return (
    <>
      <StepHeader
        leading={<StepLeafy mood="celebrate" label="Leafy celebrating" />}
        lede="Hold fn whenever you want to write. Leafy is in the corner if you need a hand."
      />
      <StepFooter
        note={finish.error ? <InlineError>{finish.error}</InlineError> : null}
        primary={(
          <Button variant="accent" size="lg" loading={finish.pending} onClick={() => void open()}>
            Open Rivertide
          </Button>
        )}
      />
    </>
  );
}
