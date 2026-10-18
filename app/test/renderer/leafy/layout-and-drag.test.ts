import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClickGate, DOUBLE_CLICK_MS, exceedsDragThreshold, windowOrigin } from '../../../src/renderer/leafy/drag';
import { LEAFY_SCALE, leafyLayout, SPRITE_HEADROOM_ROWS, TOOLBAR_HEIGHT, TOOLBAR_WIDTH } from '../../../src/renderer/leafy/layout';

describe('leafyLayout', () => {
  it('stands Leafy at the bottom on the screen-edge side with the toolbar centred above', () => {
    // Arrange + Act
    const layout = leafyLayout({ width: 240, height: 280, scale: LEAFY_SCALE.medium, corner: 'right' });
    const centre = layout.sprite.left + layout.sprite.width / 2;

    // Assert
    expect(layout.sprite).toMatchObject({ width: 96, height: 112, top: 280 - 6 - 112 });
    expect(centre).toBeGreaterThan(120);
    expect(layout.toolbar.left + TOOLBAR_WIDTH / 2).toBeCloseTo(centre);
    expect(layout.toolbar.top + TOOLBAR_HEIGHT).toBeLessThanOrEqual(layout.sprite.top + SPRITE_HEADROOM_ROWS * 4);
  });

  it('mirrors for the left corner', () => {
    const right = leafyLayout({ width: 240, height: 280, scale: 4, corner: 'right' });
    const left = leafyLayout({ width: 240, height: 280, scale: 4, corner: 'left' });

    expect(left.sprite.left).toBeCloseTo(240 - right.sprite.left - right.sprite.width);
    expect(left.bubble.side).toBe('left');
    expect(left.bubble.tailOffset).toBeCloseTo(right.bubble.tailOffset);
  });

  it('keeps the toolbar inside narrow windows', () => {
    const layout = leafyLayout({ width: 180, height: 240, scale: LEAFY_SCALE.small, corner: 'right' });

    expect(layout.toolbar.left).toBeGreaterThanOrEqual(8);
    expect(layout.toolbar.left + layout.toolbar.width).toBeLessThanOrEqual(180 - 8);
  });

  it('lifts the bubble above the toolbar and points its tail at Leafy', () => {
    const layout = leafyLayout({ width: 300, height: 340, scale: LEAFY_SCALE.large, corner: 'right' });
    const centre = layout.sprite.left + layout.sprite.width / 2;

    expect(layout.bubble.bottomLifted - layout.bubble.bottom).toBe(TOOLBAR_HEIGHT + 6);
    expect(300 - layout.bubble.inset - layout.bubble.tailOffset).toBeCloseTo(centre);
    expect(layout.bubble.minWidth).toBeGreaterThan(layout.bubble.tailOffset);
    expect(layout.bubble.maxWidth).toBe(284);
  });
});

describe('drag maths', () => {
  it('needs 4 px of travel before a press becomes a drag', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 14 })).toBe(true);
  });

  it('keeps the grab point under the pointer, in whole pixels', () => {
    expect(windowOrigin({ x: 1500.6, y: 900.2 }, { x: 120, y: 200 })).toEqual({ x: 1381, y: 700 });
  });
});

describe('createClickGate', () => {
  afterEach(() => vi.useRealTimers());

  it('fires a single click after the double-click window', () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const gate = createClickGate({ onSingle, onDouble });

    gate.click();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1);
    expect(onSingle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('turns two quick clicks into one double click', () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const gate = createClickGate({ onSingle, onDouble });

    gate.click();
    vi.advanceTimersByTime(100);
    gate.click();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);

    expect(onDouble).toHaveBeenCalledTimes(1);
    expect(onSingle).not.toHaveBeenCalled();
  });

  it('drops a pending click when disposed', () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const gate = createClickGate({ onSingle, onDouble: vi.fn() });

    gate.click();
    gate.dispose();
    vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);

    expect(onSingle).not.toHaveBeenCalled();
  });
});
