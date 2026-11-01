/** The onboarding lockup: Rivertide beside the Code the Cure mark, top-left of the window. */
import rivertideLogo from '../../../assets/onboarding/rivertide-logo.png';
import codeTheCureLogo from '../../../assets/onboarding/code-the-cure-logo.png';

export function OnboardingBrand() {
  return (
    <div className="onb-brand no-drag">
      <img src={rivertideLogo} alt="" className="onb-brand__app" />
      <span className="onb-brand__name">Rivertide</span>
      <span className="onb-brand__divider" aria-hidden />
      <img src={codeTheCureLogo} alt="" className="onb-brand__ctc" />
      <span className="onb-brand__labs">CodeTheCure Labs</span>
    </div>
  );
}
