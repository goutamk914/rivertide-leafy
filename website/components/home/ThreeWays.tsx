'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Play } from 'lucide-react';
import { LeafySprite } from '@rivertide/leafy';
import { WAYS, type Way, type WayId } from '@/content/ways';
import { Keys } from '@/components/site/Keys';
import { ClapDoodle } from '@/components/doodles/ClapDoodle';
import { useIslandActions } from '@/components/island/IslandProvider';
import { listeningScene, pastedScene, summonScene, timerDoneScene } from '@/components/island/activities';

const SPRING = { type: 'spring', bounce: 0, duration: 0.4 } as const;
const LISTEN_MS = 1600;
const RESULT_MS = 2400;

/**
 * Plays a short version of the chosen way on the navigation island. Every scene it shows clears
 * itself, and leaving the page clears whatever is still up, so nothing stays stuck on "Listening".
 */
function useIslandPreview() {
  const { show, clear } = useIslandActions();
  const timer = useRef<number | undefined>(undefined);
  const shown = useRef<string[]>([]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      shown.current.forEach((id) => clear(id));
    },
    [clear],
  );

  return useCallback(
    (id: WayId) => {
      window.clearTimeout(timer.current);
      const first = id === 'leafy' ? summonScene() : listeningScene(id === 'ask' ? 'ask' : 'dictate');
      const then = id === 'leafy' ? timerDoneScene() : pastedScene(id === 'ask' ? 'Mail' : 'Messages');
      shown.current = [first.id, then.id];
      show(first, LISTEN_MS + RESULT_MS);
      timer.current = window.setTimeout(() => show(then, RESULT_MS), LISTEN_MS);
    },
    [show],
  );
}

function WayPanel({ way, onReplay }: { readonly way: Way; readonly onReplay: () => void }) {
  return (
    <div className="ways__grid">
      <div className="ways__how">
        <div className="ways__keys">
          <Keys keys={way.keys} size="lg" />
          {way.alternative ? (
            <span className="ways__or">
              {way.alternative}
              <ClapDoodle className="ways__clap" />
            </span>
          ) : null}
        </div>
        <h3 className="rt-h3 ways__title">{way.title}</h3>
        <p className="rt-body ways__body">{way.body}</p>
        <button type="button" className="rt-btn rt-btn--ghost rt-btn--sm ways__replay" onClick={onReplay}>
          <Play size={15} strokeWidth={1.75} aria-hidden="true" />
          Show it on the island
        </button>
      </div>
      <div className="ways__exchange">
        <div className="ways__said">
          <p className="rt-label">{way.saidLabel}</p>
          <p>{way.said}</p>
        </div>
        <ArrowDown className="ways__arrow" size={18} strokeWidth={1.75} aria-hidden="true" />
        <div className="ways__result">
          <p className="rt-label">{way.resultLabel}</p>
          <div className="ways__result-row">
            {way.id === 'leafy' ? <LeafySprite mood="success" scale={2} decorative /> : null}
            <p>{way.result}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Three ways to talk, switched with Code the Cure's segmented control. Each one plays on the island. */
export function ThreeWays() {
  const [active, setActive] = useState<WayId>('dictate');
  const preview = useIslandPreview();
  const tabRefs = useRef<Partial<Record<WayId, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const way = WAYS.find((item) => item.id === active) ?? WAYS[0];

  const select = (id: WayId, focus = false) => {
    setActive(id);
    preview(id);
    if (focus) tabRefs.current[id]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const index = WAYS.findIndex((item) => item.id === active);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? WAYS.length - 1 : -1;
    if (!step && edge < 0) return;
    event.preventDefault();
    const next = edge >= 0 ? edge : (index + step + WAYS.length) % WAYS.length;
    select(WAYS[next].id, true);
  };

  return (
    <section className="rt-section" data-chapter="Three ways to talk" aria-labelledby="ways-title">
      <div className="rt-container">
        <h2 id="ways-title" className="rt-h2 rt-reveal">
          Three ways to talk.<br /> <span className="rt-beat">One key to remember.</span>
        </h2>
        <p className="rt-lede rt-reveal ways__lede">Hold fn to write. Add ctrl to ask. Add shift, or clap twice, and Leafy does it for you.</p>

        <div className="ways rt-panel rt-reveal">
          <div role="tablist" aria-label="Ways to talk" className="rt-segmented ways__tabs" onKeyDown={onKeyDown}>
            {WAYS.map((item) => {
              const selected = item.id === active;
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabRefs.current[item.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  className="rt-segmented__item"
                  onClick={() => select(item.id)}
                >
                  {selected ? <motion.span layoutId={`${baseId}-thumb`} className="rt-segmented__thumb" transition={SPRING} /> : null}
                  <span className="relative">{item.tab}</span>
                </button>
              );
            })}
          </div>

          <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="ways__panel">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={way.id}
                initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                transition={SPRING}
              >
                <WayPanel way={way} onReplay={() => preview(way.id)} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
