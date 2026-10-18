import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Speaker, findVoice, type SpeechPort } from '@renderer/engine/tts';
import { fakeReporter } from './fakes';

interface FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

const voices = [
  { name: 'Samantha', lang: 'en-US', default: true },
  { name: 'Daniel', lang: 'en-GB', default: false },
] as unknown as SpeechSynthesisVoice[];

function fakeSpeech() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    pending: false,
    cancelled: 0,
    speak: (u: SpeechSynthesisUtterance) => {
      spoken.push(u as unknown as FakeUtterance);
      synth.speaking = true;
    },
    cancel: () => {
      synth.cancelled += 1;
      synth.speaking = false;
    },
    getVoices: () => voices,
  };
  const port: SpeechPort = {
    synth: synth as unknown as SpeechPort['synth'],
    createUtterance: (text) => ({ text, voice: null, rate: 1, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
  };
  return { port, synth, spoken };
}

describe('Speaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('speaks sentence by sentence with the chosen voice and clamped rate', () => {
    // Arrange
    const { port, spoken } = fakeSpeech();
    const states: boolean[] = [];
    const speaker = new Speaker(port, fakeReporter(), (s) => states.push(s));

    // Act
    speaker.speak('It is 3 PM. Your timer is set!', 'daniel', 5);

    // Assert
    expect(spoken.map((u) => u.text)).toEqual(['It is 3 PM.', 'Your timer is set!']);
    expect(spoken.every((u) => u.voice?.name === 'Daniel' && u.rate === 2)).toBe(true);
    expect(states).toEqual([true]);
    spoken[1].onend?.();
    expect(states).toEqual([true, false]);
    expect(speaker.isSpeaking).toBe(false);
  });

  it('falls back to the default voice and ignores empty text', () => {
    const { port, spoken } = fakeSpeech();
    const speaker = new Speaker(port, fakeReporter(), () => undefined);
    speaker.speak('   ', null, 1);
    expect(spoken).toHaveLength(0);
    speaker.speak('Hello.', 'Nobody', Number.NaN);
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].rate).toBe(1);
  });

  it('stops speaking on request and on a new speak', () => {
    const { port, synth } = fakeSpeech();
    const states: boolean[] = [];
    const speaker = new Speaker(port, fakeReporter(), (s) => states.push(s));
    speaker.speak('One.', null, 1);
    speaker.speak('Two.', null, 1);
    speaker.stop();
    expect(synth.cancelled).toBe(2);
    expect(states).toEqual([true, false, true, false]);
  });

  it('reports real errors but not self-inflicted interruptions', () => {
    const { port, spoken } = fakeSpeech();
    const report = fakeReporter();
    const speaker = new Speaker(port, report, () => undefined);
    speaker.speak('A.', null, 1);
    spoken[0].onerror?.({ error: 'interrupted' });
    speaker.speak('B.', null, 1);
    spoken[1].onerror?.({ error: 'synthesis-failed' });
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'tts' })]);
    expect(speaker.isSpeaking).toBe(false);
  });

  it('recovers when the browser never fires end', () => {
    const { port, synth } = fakeSpeech();
    const speaker = new Speaker(port, fakeReporter(), () => undefined);
    speaker.speak('Hello there.', null, 1);
    synth.speaking = false;
    vi.advanceTimersByTime(1100);
    expect(speaker.isSpeaking).toBe(false);
  });

  it('reports a failing cancel', () => {
    const { port, synth } = fakeSpeech();
    const report = fakeReporter();
    synth.cancel = () => {
      throw new Error('nope');
    };
    const speaker = new Speaker(port, report, () => undefined);
    speaker.speak('Hi.', null, 1);
    speaker.stop();
    expect(report.errors[0]).toMatchObject({ scope: 'tts' });
  });
});

describe('findVoice', () => {
  it('matches exactly, then case-insensitively, else null', () => {
    expect(findVoice(voices, 'Samantha')?.name).toBe('Samantha');
    expect(findVoice(voices, 'samantha')?.name).toBe('Samantha');
    expect(findVoice(voices, 'Zoe')).toBeNull();
    expect(findVoice(voices, null)).toBeNull();
  });
});
