/**
 * The opening beat of onboarding: a curved band of images under drifting clouds, where the
 * headline changes a few times before the Enter button appears.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CloudShader } from './CloudShader';
import { TiltedGridHero, type TiltedGridImage } from './TiltedGridHero';
import rivertideLogo from '../../../assets/onboarding/rivertide-logo.png';
import img01 from '../../../assets/onboarding/carousel/carousel-01.jpg';
import img02 from '../../../assets/onboarding/carousel/carousel-02.jpg';
import img03 from '../../../assets/onboarding/carousel/carousel-03.jpg';
import img04 from '../../../assets/onboarding/carousel/carousel-04.jpg';
import img05 from '../../../assets/onboarding/carousel/carousel-05.jpg';
import img06 from '../../../assets/onboarding/carousel/carousel-06.jpg';
import img07 from '../../../assets/onboarding/carousel/carousel-07.jpg';
import img08 from '../../../assets/onboarding/carousel/carousel-08.jpg';
import img09 from '../../../assets/onboarding/carousel/carousel-09.jpg';
import img10 from '../../../assets/onboarding/carousel/carousel-10.jpg';

const IMAGES: readonly TiltedGridImage[] = [
  { src: img01, alt: '' },
  { src: img02, alt: '' },
  { src: img03, alt: '' },
  { src: img04, alt: '' },
  { src: img05, alt: '' },
  { src: img06, alt: '' },
  { src: img07, alt: '' },
  { src: img08, alt: '' },
  { src: img09, alt: '' },
  { src: img10, alt: '' },
];

/** Beat timings, in ms. */
const T_BOTTOM_MORPH = 6500;
const T_HEADLINE = 13500;
const T_TAGLINE = 18000;
const T_ENTER = 23000;

/** Outgoing copy lingers this long while it fades, then is unmounted. */
const CROSSFADE_MS = 900;

type Stage = 0 | 1 | 2 | 3 | 4;

/** Crossfades between two pieces of copy in the same grid cell. */
function Crossfade({ cacheKey, children }: { readonly cacheKey: string; readonly children: ReactNode }) {
  const prevRef = useRef<{ readonly key: string; readonly node: ReactNode } | null>(null);
  const [outgoing, setOutgoing] = useState<{ readonly key: string; readonly node: ReactNode } | null>(null);

  if (prevRef.current?.key !== cacheKey) {
    if (prevRef.current) setOutgoing(prevRef.current);
    prevRef.current = { key: cacheKey, node: children };
  }

  useEffect(() => {
    if (!outgoing) return;
    const t = window.setTimeout(() => setOutgoing(null), CROSSFADE_MS);
    return () => window.clearTimeout(t);
  }, [outgoing]);

  return (
    <span className="onb-hero__crossfade">
      {outgoing ? (
        <span key={`out-${outgoing.key}`} aria-hidden className="onb-hero__fade-out onb-hero__line">
          {outgoing.node}
        </span>
      ) : null}
      <span key={`in-${cacheKey}`} className="onb-hero__fade-in onb-hero__line">
        {children}
      </span>
    </span>
  );
}

export function OnboardingHero({ onEnter }: { readonly onEnter: () => void }) {
  const [stage, setStage] = useState<Stage>(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), T_BOTTOM_MORPH),
      window.setTimeout(() => setStage(2), T_HEADLINE),
      window.setTimeout(() => setStage(3), T_TAGLINE),
      window.setTimeout(() => setStage(4), T_ENTER),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className="onb-hero">
      <div className="onb-hero__sky" aria-hidden>
        <CloudShader
          className="onb-hero__clouds"
          speed={0.55}
          count={6}
          cloudColor="#c9d6e6"
          skyTopColor="#0d1b30"
          skyBottomColor="#24405f"
        />
      </div>

      <TiltedGridHero images={IMAGES} speed={9} axis={62} curve={80} className="onb-hero__band">
        <div className="onb-hero__scrim" />

        <div className="onb-hero__inner">
        <div className="onb-hero__headline-wrap">
          <h1 className="onb-hero__title">
            <Crossfade cacheKey={stage < 2 ? 'intro' : 'meet'}>
              {stage < 2 ? (
                <>Imagine a computer experience</>
              ) : (
                <span className="onb-hero__brandline">
                  Meet
                  <img src={rivertideLogo} alt="" className="onb-hero__logo" />
                  Rivertide,
                </span>
              )}
            </Crossfade>
            <br />
            <Crossfade cacheKey={stage === 0 ? 'speak' : stage === 1 ? 'journey' : 'hub'}>
              {stage === 0 ? (
                <>where you only speak</>
              ) : stage === 1 ? (
                <>made for <em>your</em> cancer journey</>
              ) : (
                <>the <em>one</em> and <em>only</em> productivity hub</>
              )}
            </Crossfade>
          </h1>
        </div>

        <div className="onb-hero__foot">
          {stage >= 3 ? (
            <p key="tagline" className="onb-hero__tagline onb-hero__rise">
              for cancer patients
            </p>
          ) : null}

          {stage >= 4 ? (
            <button key="enter" type="button" onClick={onEnter} autoFocus className="onb-hero__enter onb-hero__rise">
              Enter
            </button>
          ) : null}
        </div>
        </div>
      </TiltedGridHero>
    </div>
  );
}
