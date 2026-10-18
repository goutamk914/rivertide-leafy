import { describe, expect, it } from 'vitest';
import {
  STEP_COUNT, STEP_IDS, nextStep, previousStep, progressFraction, progressLabel, stepFromSection, stepNumber, stepSection,
} from '../../../../src/renderer/dashboard/pages/onboarding/steps';

describe('onboarding steps', () => {
  it('has six steps in the order people meet them', () => {
    // Arrange + Act + Assert
    expect(STEP_IDS).toEqual(['welcome', 'permissions', 'ai', 'try', 'leafy', 'done']);
    expect(STEP_COUNT).toBe(6);
  });

  it('reads the step from the route section and falls back to welcome', () => {
    // Arrange
    const cases: ReadonlyArray<readonly [string | null, string]> = [
      ['permissions', 'permissions'],
      ['done', 'done'],
      [null, 'welcome'],
      ['nope', 'welcome'],
      ['', 'welcome'],
    ];

    // Act + Assert
    for (const [section, expected] of cases) expect(stepFromSection(section)).toBe(expected);
  });

  it('mirrors every step but the first into the route section', () => {
    // Arrange + Act + Assert
    expect(stepSection('welcome')).toBeNull();
    expect(stepSection('ai')).toBe('ai');
  });

  it('moves forward and back without running off either end', () => {
    // Arrange + Act + Assert
    expect(nextStep('welcome')).toBe('permissions');
    expect(nextStep('done')).toBeNull();
    expect(previousStep('permissions')).toBe('welcome');
    expect(previousStep('welcome')).toBeNull();
  });

  it('describes progress in words and as a fraction', () => {
    // Arrange + Act + Assert
    expect(stepNumber('try')).toBe(4);
    expect(progressLabel('permissions')).toBe('Step 2 of 6');
    expect(progressFraction('welcome')).toBeCloseTo(1 / 6);
    expect(progressFraction('done')).toBe(1);
  });
});
