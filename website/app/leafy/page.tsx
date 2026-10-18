import type { Metadata } from 'next';
import { Keys } from '@/components/site/Keys';
import { MoodPlayground } from '@/components/leafy/MoodPlayground';
import { PoseGrid } from '@/components/leafy/PoseGrid';
import { LeafyPalette } from '@/components/leafy/LeafyPalette';
import { ClapDoodle } from '@/components/doodles/ClapDoodle';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = pageMetadata({
  title: 'Meet Leafy',
  description: 'Leafy is Rivertide’s face: a pixel-art sprout that listens, does the clicking, and tells you when it is done. All 100 poses, and every way to call it.',
  path: '/leafy/',
});

const SUMMON: readonly { readonly keys: readonly string[]; readonly what: string }[] = [
  { keys: ['shift', 'fn'], what: 'Hold and say what you want done.' },
  { keys: ['⌘', '⇧', 'L'], what: 'Start a voice command from anywhere.' },
  { keys: ['⌘', '⇧', 'Space'], what: 'Open the Leafy palette to search or ask.' },
];

export default function LeafyPage() {
  return (
    <main id="main" className="leafy-page">
      <section className="rt-section leafy-intro" data-chapter="Meet Leafy" aria-labelledby="leafy-page-title">
        <div className="rt-container leafy-intro__grid">
          <div>
            <h1 id="leafy-page-title" className="rt-display hero__title rt-unblur">
              Meet Leafy.
              <br />
              <span className="rt-beat">A sprout that helps.</span>
            </h1>
            <p className="rt-lede leafy-intro__lede">
              Leafy is Rivertide’s face. It sits in the corner of your screen, listens when you ask, does the clicking, and
              tells you what it did. Every state looks different, so you always know whether it is listening, thinking or done.
            </p>
          </div>
          <MoodPlayground />
        </div>
      </section>

      <section className="rt-section" data-chapter="Calling Leafy" aria-labelledby="summon-title">
        <div className="rt-container">
          <h2 id="summon-title" className="rt-h2 rt-reveal">
            Four ways to call it.
            <br />
            <span className="rt-beat">Or just click it.</span>
          </h2>
          <ul className="summon rt-reveal">
            {SUMMON.map((item) => (
              <li key={item.what} className="summon__item">
                <Keys keys={item.keys} size="lg" />
                <p className="rt-body">{item.what}</p>
              </li>
            ))}
            <li className="summon__item">
              <ClapDoodle className="summon__clap" />
              <p className="rt-body">Clap twice, if you turn it on. Leafy says hello and listens for what you need. A clap never runs anything by itself.</p>
            </li>
          </ul>
          <div className="leafy-page__palette rt-reveal">
            <LeafyPalette />
          </div>
        </div>
      </section>

      <section className="rt-section" data-chapter="All 100 poses" aria-labelledby="poses-title">
        <div className="rt-container">
          <h2 id="poses-title" className="rt-h2 rt-reveal">
            All 100 poses.
            <br />
            <span className="rt-beat">Drawn one pixel at a time.</span>
          </h2>
          <p className="rt-lede poses__lede rt-reveal">
            Leafy is 24 by 28 pixels and never gets blurry. These are the poses the app picks from as it listens, works and
            rests.
          </p>
          <PoseGrid />
        </div>
      </section>
    </main>
  );
}
