/**
 * Shared frame for every onboarding step: the context that moves between steps, the step's one h1
 * (focused when the step changes so screen readers hear where they are), and the Back / Next footer.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Button, ICON_STROKE } from '../../../ui/components';
import { PAGE_TITLE_ID } from '../../shell/Page';
import { STEP_TITLES, previousStep, type StepId } from './steps';

export interface StepNav {
  readonly step: StepId;
  readonly goNext: () => void;
  readonly goBack: () => void;
  /** True once the person has moved between steps (not on first load). */
  readonly focusHeading: boolean;
}

const StepNavContext = createContext<StepNav | null>(null);

export const StepNavProvider = StepNavContext.Provider;

export function useStepNav(): StepNav {
  const nav = useContext(StepNavContext);
  if (!nav) throw new Error('useStepNav() must be used inside an onboarding step.');
  return nav;
}

export interface StepHeaderProps {
  /** One or two short sentences under the title. */
  readonly lede?: ReactNode;
  /** Shown above the title (Leafy). */
  readonly leading?: ReactNode;
}

/** The step's title as the page's only h1; takes focus when the step changes. */
export function StepHeader({ lede, leading }: StepHeaderProps) {
  const { step, focusHeading } = useStepNav();
  const ref = useRef<HTMLHeadingElement>(null);
  const [first, second] = STEP_TITLES[step];

  useEffect(() => {
    if (focusHeading) ref.current?.focus({ preventScroll: true });
  }, [focusHeading]);

  return (
    <header className="onb-head">
      {leading ? <div className="onb-head__leading">{leading}</div> : null}
      <h1 ref={ref} id={PAGE_TITLE_ID} className="onb-head__title" tabIndex={-1}>
        {first}
        {second ? <span className="onb-head__beat"> {second}</span> : null}
      </h1>
      {lede ? <p className="onb-head__lede">{lede}</p> : null}
    </header>
  );
}

export interface StepFooterProps {
  /** The single accent button that moves forward. */
  readonly primary: ReactNode;
  /** Quiet line beside the buttons ("you can do this later", or an <InlineError>). */
  readonly note?: ReactNode;
}

/** Back (from the second step on) on the left, the forward action on the right. */
export function StepFooter({ primary, note }: StepFooterProps) {
  const { step, goBack } = useStepNav();
  const canGoBack = previousStep(step) !== null;
  return (
    <footer className="onb-foot">
      <div className="onb-foot__note">{note}</div>
      <div className="onb-foot__actions">
        {canGoBack ? (
          <Button variant="quiet" size="lg" icon={ArrowLeft} onClick={goBack}>
            Back
          </Button>
        ) : null}
        {primary}
      </div>
    </footer>
  );
}

/** Inline error under a control or in the footer: announced, and marked by an icon, not colour alone. */
export function InlineError({ children }: { readonly children: ReactNode }) {
  return (
    <p className="onb-error" role="alert">
      <CircleAlert size={18} strokeWidth={ICON_STROKE} aria-hidden className="onb-error__icon" />
      <span>{children}</span>
    </p>
  );
}
