/**
 * First-run setup, shown full-window without the sidebar until `settings.onboarded` is true.
 * Six calm steps, one job each. The current step lives in state and is mirrored to the route
 * (`/onboarding/permissions`) so a reload lands on the same step.
 */
import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { navigate, routePath } from '../../../lib/router';
import type { PageComponentProps } from '../../shell/Page';
import { AiStep } from './AiStep';
import { DoneStep } from './DoneStep';
import { LeafyStep } from './LeafyStep';
import { PermissionsStep } from './PermissionsStep';
import { StepNavProvider, type StepNav } from './step-frame';
import {
  STEP_COUNT, nextStep, previousStep, progressFraction, progressLabel, stepFromSection, stepNumber, stepSection,
  type StepId,
} from './steps';
import { TryStep } from './TryStep';
import { WelcomeStep } from './WelcomeStep';
import './onboarding.css';
import './onboarding-steps.css';

const STEP_COMPONENTS: Readonly<Record<StepId, ComponentType>> = {
  welcome: WelcomeStep,
  permissions: PermissionsStep,
  ai: AiStep,
  try: TryStep,
  leafy: LeafyStep,
  done: DoneStep,
};

function Progress({ step }: { readonly step: StepId }) {
  const label = progressLabel(step);
  return (
    <div className="onb-progress">
      <p className="onb-progress__label">{label}</p>
      <div
        className="onb-progress__track"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={stepNumber(step)}
        aria-valuetext={label}
      >
        <span className="onb-progress__fill" style={{ transform: `scaleX(${progressFraction(step)})` }} />
      </div>
    </div>
  );
}

export function OnboardingPage({ route }: PageComponentProps) {
  const [step, setStep] = useState<StepId>(() => stepFromSection(route.section));
  const [moved, setMoved] = useState(false);

  const goTo = useCallback((target: StepId | null) => {
    if (!target) return;
    setStep(target);
    setMoved(true);
    const scroller = document.getElementById('main');
    if (scroller) scroller.scrollTop = 0;
    navigate(routePath('onboarding', stepSection(target)), { replace: true });
  }, []);

  const nav = useMemo<StepNav>(
    () => ({ step, focusHeading: moved, goNext: () => goTo(nextStep(step)), goBack: () => goTo(previousStep(step)) }),
    [step, moved, goTo],
  );

  const StepComponent = STEP_COMPONENTS[step];
  return (
    <div className="onb">
      <div className="onb__strip drag-region" />
      <main id="main" className="onb__scroll scroll-y" tabIndex={-1}>
        <div className="onb__column">
          <Progress step={step} />
          <StepNavProvider value={nav}>
            <div key={step} className="onb-step">
              <StepComponent />
            </div>
          </StepNavProvider>
        </div>
      </main>
    </div>
  );
}
