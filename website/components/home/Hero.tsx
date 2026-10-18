import { DownloadButton, GhostLink } from '@/components/site/Buttons';
import { HoldDemo } from './hero/HoldDemo';

/** Left: the promise in two beats. Right: try it, by holding a key. */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="rt-container hero__grid">
        <div className="hero__copy">
          <h1 id="hero-title" className="rt-display hero__title rt-unblur">
            You speak naturally.
            <br />
            <span className="rt-beat">Rivertide writes clearly.</span>
          </h1>
          <p className="rt-lede hero__lede">
            Hold one key and talk. Rivertide types the sentence you meant, right where your cursor is.
          </p>
          <div className="hero__actions">
            <DownloadButton />
            <GhostLink href="/#how-it-works">See how it works</GhostLink>
          </div>
          <p className="hero__note">Free and open source. Your history stays on your Mac.</p>
        </div>

        <div className="hero__demo">
          <div className="hero__glow" aria-hidden="true" />
          <HoldDemo />
        </div>
      </div>
    </section>
  );
}
