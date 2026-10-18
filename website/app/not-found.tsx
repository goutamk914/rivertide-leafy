import Link from 'next/link';
import { LeafySprite } from '@rivertide/leafy';

/** Empty state: Leafy, one sentence, one action. */
export default function NotFound() {
  return (
    <main id="main" className="rt-section not-found">
      <div className="rt-container not-found__inner">
        <LeafySprite pose="peek-curious" scale={6} decorative />
        <h1 className="rt-h2">This page isn’t here.</h1>
        <p className="rt-lede">The link may be old, or the page moved.</p>
        <Link href="/" className="rt-btn rt-btn--primary">
          Back to Rivertide
        </Link>
      </div>
    </main>
  );
}
