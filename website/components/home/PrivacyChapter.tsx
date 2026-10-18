import Link from 'next/link';
import { DataFlowTable } from '@/components/privacy/DataFlowTable';

/** The page's one light chapter: privacy, on paper, as a plain table. */
export function PrivacyChapter() {
  return (
    <section className="paper rt-section privacy-chapter" data-chapter="Privacy" aria-labelledby="privacy-title">
      <div className="rt-container">
        <h2 id="privacy-title" className="rt-h2 rt-reveal">
          Your words stay yours.<br /> <span className="rt-beat">Here is where they go.</span>
        </h2>
        <p className="rt-lede rt-reveal privacy-chapter__lede">
          No account and no Code the Cure servers. You choose who turns your voice into text, or keep all of it on your Mac.
        </p>
        <div className="rt-reveal privacy-chapter__table">
          <DataFlowTable caption="Where Rivertide sends each kind of data" />
        </div>
        <p className="privacy-chapter__more rt-reveal">
          <Link href="/privacy/" className="rt-inline-link">
            The full privacy story, with every permission explained
          </Link>
        </p>
      </div>
    </section>
  );
}
