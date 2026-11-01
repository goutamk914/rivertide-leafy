/**
 * Onboarding background music with a play/pause button. Mounted only by onboarding, and
 * hard-stopped and rewound on unmount so it can never play on any other page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ICON_STROKE } from '../../../ui/components';
import audioSrc from '../../../assets/onboarding/tranquility.mp3';

const VOLUME = 0.3;

export function OnboardingMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = VOLUME;
    // Chromium blocks audible autoplay until the user interacts. Swallow the rejection and
    // leave the button in the paused state so a click can start it. Older test DOMs return
    // undefined rather than a promise, so the result is guarded.
    const played = el.play();
    if (played && typeof played.then === 'function') {
      played.then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, []);

  useEffect(() => {
    start();
    const el = audioRef.current;

    // Where autoplay is still blocked (the browser dev preview), the first interaction of any
    // kind starts the music. The listeners fire once, so a later deliberate pause stays paused.
    const onGesture = () => {
      disarm();
      if (audioRef.current?.paused) start();
    };
    const disarm = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);

    return () => {
      disarm();
      if (!el) return;
      el.pause();
      el.currentTime = 0;
    };
  }, [start]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      start();
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const label = playing ? 'Pause music' : 'Play music';
  const Icon = playing ? Pause : Play;

  return (
    <>
      <audio ref={audioRef} src={audioSrc} loop preload="auto" />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={label}
        title={label}
        className="onb-music no-drag"
      >
        <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </>
  );
}
