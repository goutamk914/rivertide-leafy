import { describe, expect, it } from 'vitest';
import { ANIMATIONS, animationDuration, frameAt, settledMood, type LeafyMood } from '../animations';
import { LEAFY, POSE_NAMES, getPose, isPoseName } from '../poses';
import { blinkPixels, frameFromPose, frameToSvg, shiftBody } from '../render';

describe('pose pack', () => {
  it('loads all 100 poses on a 24x28 grid', () => {
    expect(LEAFY.width).toBe(24);
    expect(LEAFY.height).toBe(28);
    expect(LEAFY.poses.size).toBe(100);
    expect(POSE_NAMES).toHaveLength(100);
  });

  it('uses only palette keys or transparency in every pose', () => {
    const keys = new Set(Object.keys(LEAFY.palette));
    for (const pose of LEAFY.poses.values()) {
      for (const row of pose.pixels) {
        for (const ch of row) expect(ch === '.' || keys.has(ch)).toBe(true);
      }
    }
  });

  it('recognises pose names and rejects unknown ones', () => {
    expect(isPoseName('typing')).toBe(true);
    expect(isPoseName('dancing-wildly')).toBe(false);
    expect(() => getPose('nope' as never)).toThrow('Unknown Leafy pose');
  });
});

describe('blinkPixels', () => {
  it('closes the eyes of a front-facing pose', () => {
    const neutral = getPose('neutral').pixels;
    const blinked = blinkPixels(neutral);
    expect(blinked).not.toEqual(neutral);
    expect(blinked.join('')).not.toContain('W');
  });

  it('returns the same rows when a pose has no open eyes', () => {
    const back = getPose('back-view').pixels;
    expect(blinkPixels(back)).toBe(back);
  });
});

describe('shiftBody', () => {
  it('lifts the body but keeps the ground shadow in place', () => {
    const rows = getPose('neutral').pixels;
    const lifted = shiftBody(rows, -1);
    expect(lifted).toHaveLength(rows.length);
    expect(lifted[lifted.length - 1]).toBe(rows[rows.length - 1]);
    expect(lifted[rows.length - 3]).toBe(rows[rows.length - 2]);
  });

  it('is a no-op for a zero offset', () => {
    const rows = getPose('smile').pixels;
    expect(shiftBody(rows, 0)).toBe(rows);
  });
});

describe('frameToSvg', () => {
  it('renders crisp rects with an accessible title', () => {
    const svg = frameToSvg(frameFromPose(getPose('happy')), { scale: 2, title: 'Leafy <3' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('<title>Leafy &lt;3</title>');
    expect(svg).toContain('width="48"');
  });
});

describe('frameAt', () => {
  it('walks through the thinking poses in order', () => {
    expect(frameAt('thinking', 0).pose).toBe('think-dots');
    expect(frameAt('thinking', 900).pose).toBe('think-hmm');
    expect(frameAt('thinking', 1800).pose).toBe('think-question');
  });

  it('loops looping moods and finishes one-shot moods', () => {
    const working = animationDuration(ANIMATIONS.working);
    expect(frameAt('working', working + 10).pose).toBe('typing');
    expect(frameAt('working', working * 3).done).toBe(false);
    const success = animationDuration(ANIMATIONS.success);
    expect(frameAt('success', success + 1).done).toBe(true);
    expect(frameAt('success', success + 1).pose).toBe('thumbs-up');
  });

  it('holds still under reduced motion', () => {
    for (let t = 0; t < 10_000; t += 97) {
      const frame = frameAt('idle', t, { reducedMotion: true });
      expect(frame.offsetY).toBe(0);
      expect(frame.blink).toBe(false);
    }
  });

  it('blinks and breathes while idle', () => {
    const frames = Array.from({ length: 400 }, (_, i) => frameAt('idle', i * 25));
    expect(frames.some((f) => f.blink)).toBe(true);
    expect(frames.some((f) => f.offsetY === -1)).toBe(true);
  });

  it('references only real poses in every animation', () => {
    for (const mood of Object.keys(ANIMATIONS) as LeafyMood[]) {
      for (const s of ANIMATIONS[mood].steps) expect(isPoseName(s.pose)).toBe(true);
    }
  });
});

describe('settledMood', () => {
  it('returns the follow-up mood for one-shots and itself for loops', () => {
    expect(settledMood('clap')).toBe('listening');
    expect(settledMood('success')).toBe('idle');
    expect(settledMood('thinking')).toBe('thinking');
  });
});
