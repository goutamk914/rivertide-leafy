import { describe, expect, it } from 'vitest';
import { stepIndex } from '../../../../src/renderer/dashboard/pages/insights/chart-hooks';

describe('stepIndex', () => {
  it('moves one day with the arrow keys and stops at the ends', () => {
    expect(stepIndex('ArrowLeft', 3, 7)).toBe(2);
    expect(stepIndex('ArrowRight', 3, 7)).toBe(4);
    expect(stepIndex('ArrowDown', 0, 7)).toBe(0);
    expect(stepIndex('ArrowUp', 6, 7)).toBe(6);
  });

  it('jumps to the first and last day with Home and End', () => {
    expect(stepIndex('Home', 3, 7)).toBe(0);
    expect(stepIndex('End', 3, 7)).toBe(6);
  });

  it('starts from the latest day when nothing is active yet', () => {
    expect(stepIndex('ArrowLeft', null, 7)).toBe(5);
  });

  it('ignores other keys and empty charts', () => {
    expect(stepIndex('Enter', 3, 7)).toBeNull();
    expect(stepIndex('ArrowLeft', null, 0)).toBeNull();
  });
});
