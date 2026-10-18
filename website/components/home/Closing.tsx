'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { DownloadButton, GhostLink } from '@/components/site/Buttons';
import { RivertideDoodle } from '@/components/doodles/RivertideDoodle';

interface ArtifactProps {
  readonly at: CSSProperties;
  /** How far it leans toward the cursor, in px. */
  readonly depth: number;
  readonly rotate: number;
  readonly duration: number;
  readonly delay: number;
  readonly children: ReactNode;
}

/** Positions a keycap, leans it toward the cursor, and floats it twice before it rests (CTC HeroArtifacts). */
function Artifact({ at, depth, rotate, duration, delay, children }: ArtifactProps) {
  return (
    <div className="closing__artifact" style={{ ...at, transform: `translate3d(calc(var(--mx) * ${depth}px), calc(var(--my) * ${depth}px), 0)` }}>
      <div className="rt-float" style={{ '--r': `${rotate}deg`, '--d': `${duration}s`, '--delay': `${delay}s` } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

function useCursorLean(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--mx', (event.clientX / window.innerWidth - 0.5).toFixed(3));
        element.style.setProperty('--my', (event.clientY / window.innerHeight - 0.5).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/** The last word, with the keys you will use floating around it. */
export function Closing() {
  const field = useRef<HTMLDivElement>(null);
  useCursorLean(field);

  return (
    <section className="rt-section closing" aria-labelledby="closing-title">
      <div ref={field} className="closing__field" aria-hidden="true" style={{ '--mx': 0, '--my': 0 } as CSSProperties}>
        <Artifact at={{ left: '9%', top: '18%' }} depth={26} rotate={-12} duration={9} delay={0}>
          <div className="rt-key rt-key--lit closing__key">
            <span className="closing__key-fn">fn</span>
            <Globe size={16} strokeWidth={1.75} className="closing__key-globe" />
          </div>
        </Artifact>
        <Artifact at={{ left: '15%', top: '62%' }} depth={38} rotate={8} duration={11} delay={-3}>
          <div className="rt-key closing__key closing__key--wide">ctrl</div>
        </Artifact>
        <Artifact at={{ right: '10%', top: '16%' }} depth={30} rotate={7} duration={10} delay={-1.5}>
          <div className="rt-key closing__key closing__key--small">esc</div>
        </Artifact>
        <Artifact at={{ right: '13%', top: '60%' }} depth={22} rotate={-6} duration={8.5} delay={-4}>
          <div className="rt-key closing__key closing__key--wide">shift</div>
        </Artifact>
      </div>

      <div className="rt-container closing__content">
        <h2 id="closing-title" className="rt-h2 closing__title rt-reveal">
          Talk the way you talk. <br />
          <span className="rt-beat">Rivertide takes it from there.</span>
        </h2>
        <div className="closing__actions rt-reveal">
          <DownloadButton />
          <GhostLink href="/download/">Read the install guide</GhostLink>
        </div>
        <p className="closing__note rt-reveal">For macOS 13 or later. Free and open source.</p>
        <RivertideDoodle className="closing__doodle" />
      </div>
    </section>
  );
}
