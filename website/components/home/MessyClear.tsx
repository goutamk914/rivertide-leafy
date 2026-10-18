'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { MESSY_CLEAN, MESSY_WORDS, type SpokenWord } from '@/content/demo';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';

/** Scroll budget inside the pinned stage: fill the words, let the fillers go, then show the result. */
const FILL_START = 0.04;
const FILL_END = 0.56;
const DROP_START = 0.6;
const DROP_END = 0.74;
const CLEAN_START = 0.76;
const CLEAN_END = 0.9;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function FillWord({ word, progress, start, end }: { readonly word: SpokenWord; readonly progress: MotionValue<number>; readonly start: number; readonly end: number }) {
  const backgroundImage = useTransform(progress, (value) => {
    const amount = clamp01((value - start) / (end - start)) * 100;
    return `linear-gradient(90deg, var(--ink) ${amount}%, var(--ink-faint) ${amount}%)`;
  });
  const dropped = useTransform(progress, [DROP_START, DROP_END], [0, 1], { clamp: true });
  const opacity = useTransform(dropped, [0, 1], [1, word.drop ? 0.28 : 1]);
  const strike = useTransform(dropped, (value) => (word.drop ? value : 0));
  return (
    <motion.span className="messy__word" style={{ opacity }}>
      <motion.span className="rt-fill-word" style={{ backgroundImage }}>
        {word.text}
      </motion.span>
      {word.drop ? <motion.span className="messy__strike" style={{ scaleX: strike }} aria-hidden="true" /> : null}
    </motion.span>
  );
}

function CleanSentence() {
  return (
    <>
      <p className="rt-label">What Rivertide types</p>
      <p className="messy__sentence">{MESSY_CLEAN}</p>
    </>
  );
}

function StaticWord({ word }: { readonly word: SpokenWord }) {
  return <span className={word.drop ? 'messy__word is-dropped' : 'messy__word'}>{word.text}</span>;
}

/**
 * "Messy in, clear out". A real-sounding transcript fills in word by word as you scroll (Code the
 * Cure's filled-word effect), then the ums, restarts and take-backs fade and get struck out, and the
 * sentence Rivertide would type comes into focus underneath.
 */
export function MessyClear() {
  const ref = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const cleanOpacity = useTransform(scrollYProgress, [CLEAN_START, CLEAN_END], [0, 1]);
  const cleanBlur = useTransform(scrollYProgress, [CLEAN_START, CLEAN_END], ['blur(6px)', 'blur(0px)']);
  const cleanY = useTransform(scrollYProgress, [CLEAN_START, CLEAN_END], [10, 0]);
  const count = MESSY_WORDS.length;

  return (
    <section ref={ref} id="how-it-works" data-chapter="Messy in, clear out" className={reduced ? 'messy is-static' : 'messy'} aria-labelledby="messy-title">
      <div className="messy__stage">
        <div className="rt-container">
          <h2 id="messy-title" className="rt-h2">
            Messy in. <span className="rt-beat">Clear out.</span>
          </h2>
          <p className="messy__transcript">
            <span className="sr-only">What someone said: </span>
            {MESSY_WORDS.map((word, index) => (
              <span key={index}>
                {reduced ? (
                  <StaticWord word={word} />
                ) : (
                  <FillWord
                    word={word}
                    progress={scrollYProgress}
                    start={FILL_START + ((FILL_END - FILL_START) * index) / count}
                    end={FILL_START + ((FILL_END - FILL_START) * (index + 1)) / count}
                  />
                )}{' '}
              </span>
            ))}
          </p>
          {/* Reduced motion swaps in a plain element: reusing the motion one would keep the
              prerendered opacity 0 / blur styles, because the preference only arrives after hydration. */}
          {reduced ? (
            <div key="static" className="messy__clean">
              <CleanSentence />
            </div>
          ) : (
            <motion.div key="live" className="messy__clean" style={{ opacity: cleanOpacity, filter: cleanBlur, y: cleanY }}>
              <CleanSentence />
            </motion.div>
          )}
          <p className="rt-body messy__note">
            It drops the ums, the restarts and the words you took back. What you meant stays, in your own words.
          </p>
        </div>
      </div>
    </section>
  );
}
