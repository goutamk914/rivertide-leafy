'use client';

import { useId, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  SPLIT_GAP,
  islandRadius,
  islandTiming,
  mergeSizes,
  nextTransition,
  resolveSize,
  splitOffset,
  transitionKey,
  type TransitionKey,
  type TransitionTrack,
} from './geometry';
import { IslandGoo } from './IslandGoo';
import { BodyLayer, BubbleLayer, SlotLayer } from './IslandLayers';
import type { DynamicIslandProps, IslandMode } from './types';

/** Island ink is fixed: a black capsule with white content, whatever the page theme. */
const CAPSULE_FILL = '#000';
const CAPSULE_INK = '#fff';

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Remembers the last mode and scene so each change knows where it came from (fromSplitToLarge,
 * ...), using the "adjust state while rendering" pattern rather than a ref. Settles in one extra
 * render because `nextTransition` returns the same record once nothing has changed.
 */
function useTransitionKey(mode: IslandMode, sceneId: string | null): TransitionKey {
  const [track, setTrack] = useState<TransitionTrack>(() => ({ mode, sceneId, key: transitionKey(mode, mode) }));
  const next = nextTransition(track, mode, sceneId);
  if (next !== track) setTrack(next);
  return next.key;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void): () => void {
  const list = window.matchMedia(REDUCED_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** The OS preference, but `false` during prerender and hydration so server and client markup match. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/**
 * A black capsule that morphs between compact, stretched, split and large with the springs of
 * jhaemin/dynamic-island. Position it yourself (e.g. fixed, top-centre); the root is a full-width
 * flex row that ignores the pointer everywhere except on the capsule and its bubble.
 */
export function DynamicIsland({
  scene,
  sizes: sizeOverrides,
  onPointerEnter,
  onPointerLeave,
  reducedMotion,
  className,
  'aria-label': ariaLabel,
  children,
}: DynamicIslandProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  const sizes = useMemo(() => mergeSizes(sizeOverrides), [sizeOverrides]);
  const mode: IslandMode = scene?.mode ?? 'compact';
  const key = useTransitionKey(mode, scene?.id ?? null);
  const timing = islandTiming(key, reduced);

  const size = resolveSize(mode, scene, sizes);
  const splitHeight = resolveSize('split', mode === 'split' ? scene : null, sizes).height;
  const travel = SPLIT_GAP + sizes.bubble;
  const filterId = `rt-island-goo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const showSlots = Boolean(scene && mode !== 'large' && (scene.leading || scene.trailing));
  const showBody = Boolean(scene && mode === 'large' && scene.body);
  const showBubble = Boolean(scene && mode === 'split' && scene.bubble);

  return (
    <div
      className={['rt-island', className].filter(Boolean).join(' ')}
      data-mode={mode}
      data-scene={scene?.id}
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      style={{ display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}
    >
      <motion.div
        className="rt-island__capsule"
        initial={false}
        animate={{ width: size.width, height: size.height, x: mode === 'split' ? splitOffset(sizes.bubble) : 0, borderRadius: islandRadius(mode, size, sizes) }}
        transition={timing.shape}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={{ position: 'relative', flex: 'none', background: CAPSULE_FILL, color: CAPSULE_INK, pointerEvents: 'auto', willChange: 'width, height, transform' }}
      >
        {children}

        <IslandGoo mode={mode} height={splitHeight} bubble={sizes.bubble} timing={timing} filterId={filterId} />

        <div className="rt-island__clip" style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit' }}>
          <AnimatePresence initial={false}>
            {showSlots && scene && (
              <SlotLayer
                key={`slots:${scene.id}`}
                leading={scene.leading}
                trailing={scene.trailing}
                height={size.height}
                timing={timing}
                reduced={reduced}
              />
            )}
            {showBody && scene && (
              <BodyLayer key={`body:${scene.id}`} size={size} timing={timing} reduced={reduced}>
                {scene.body}
              </BodyLayer>
            )}
          </AnimatePresence>
        </div>

        <div
          className="rt-island__bubble-slot"
          style={{ position: 'absolute', top: 0, left: '100%', marginLeft: SPLIT_GAP, width: sizes.bubble, height: splitHeight, pointerEvents: showBubble ? 'auto' : 'none' }}
        >
          <AnimatePresence initial={false}>
            {showBubble && scene && (
              <BubbleLayer key={`bubble:${scene.id}`} travel={travel} timing={timing} reduced={reduced}>
                {scene.bubble}
              </BubbleLayer>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <span role="status" aria-live="polite" style={visuallyHidden}>
        {scene?.label ?? ''}
      </span>
    </div>
  );
}
