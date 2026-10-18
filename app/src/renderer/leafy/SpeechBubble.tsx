import { AnimatePresence, motion } from 'motion/react';
import { Check, CircleAlert } from 'lucide-react';
import type { BubbleContent, BubbleTone } from './bubble';
import type { LeafyLayout } from './layout';
import type { RegionHandlers } from './usePointerRegions';

export interface SpeechBubbleProps {
  readonly content: BubbleContent | null;
  readonly box: LeafyLayout['bubble'];
  /** Lifted above the toolbar while it is open, so the two never overlap. */
  readonly lifted: boolean;
  readonly reducedMotion: boolean;
  readonly regionHandlers: RegionHandlers;
  readonly onDismiss: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function StatusGlyph({ tone }: { readonly tone: BubbleTone }) {
  if (tone === 'done') return <Check className="lf-bubble__glyph lf-bubble__glyph--done" size={14} strokeWidth={2.5} aria-hidden />;
  if (tone === 'error') return <CircleAlert className="lf-bubble__glyph lf-bubble__glyph--error" size={14} strokeWidth={2.25} aria-hidden />;
  if (tone === 'live') return <span className="lf-bubble__dot" aria-hidden />;
  if (tone === 'busy') {
    return (
      <span className="lf-bubble__dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    );
  }
  return null;
}

/**
 * Leafy's white speech bubble: a title line (what was heard, a reply, a cue) and a quiet status
 * line. The tail points at Leafy from whichever side has room. Click to dismiss.
 */
export function SpeechBubble({ content, box, lifted, reducedMotion, regionHandlers, onDismiss }: SpeechBubbleProps) {
  const lift = lifted ? -(box.bottomLifted - box.bottom) : 0;
  const hidden = reducedMotion ? { opacity: 0 } : { opacity: 0, y: lift + 6, scale: 0.97 };
  const edge = box.side === 'right' ? { right: box.inset } : { left: box.inset };
  const tail = box.side === 'right' ? { right: box.tailOffset - 6 } : { left: box.tailOffset - 6 };
  const origin = `${box.side === 'right' ? `calc(100% - ${box.tailOffset}px)` : `${box.tailOffset}px`} 100%`;

  return (
    <div role="status" aria-live="polite" className="lf-bubble-region">
      <AnimatePresence>
        {content ? (
          <motion.div
            key="bubble"
            className="lf-bubble"
            data-tone={content.tone}
            style={{ ...edge, bottom: box.bottom, maxWidth: box.maxWidth, minWidth: box.minWidth, transformOrigin: origin }}
            initial={hidden}
            animate={{ opacity: 1, y: lift, scale: 1 }}
            exit={{ ...hidden, transition: { duration: 0.16, ease: EASE } }}
            transition={{ duration: reducedMotion ? 0.15 : 0.24, ease: EASE }}
            onClick={onDismiss}
            {...regionHandlers}
          >
            <p key={`t:${content.key}`} className="lf-bubble__title">
              {content.title}
            </p>
            {content.status ? (
              <p className="lf-bubble__status">
                <StatusGlyph tone={content.tone} />
                <span>{content.status}</span>
              </p>
            ) : null}
            <span className="lf-bubble__tail" style={tail} aria-hidden />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
