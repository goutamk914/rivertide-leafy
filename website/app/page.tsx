import type { Metadata } from 'next';
import { Hero } from '@/components/home/Hero';
import { MessyClear } from '@/components/home/MessyClear';
import { ThreeWays } from '@/components/home/ThreeWays';
import { MeetLeafy } from '@/components/home/MeetLeafy';
import { Remembers } from '@/components/home/Remembers';
import { FoggySignal } from '@/components/home/FoggySignal';
import { PrivacyChapter } from '@/components/home/PrivacyChapter';
import { Shortcuts } from '@/components/home/Shortcuts';
import { Faq } from '@/components/home/Faq';
import { Closing } from '@/components/home/Closing';
import { SITE_DESCRIPTION, SITE_TAGLINE } from '@/lib/site';
import { pageMetadata } from '@/lib/metadata';

export const metadata: Metadata = {
  ...pageMetadata({ title: SITE_TAGLINE, description: SITE_DESCRIPTION, path: '/' }),
  title: { absolute: `Rivertide: ${SITE_TAGLINE}` },
};

/** The home page reads like Code the Cure's: a film of short chapters, each with one job. */
export default function HomePage() {
  return (
    <main id="main">
      <Hero />
      <MessyClear />
      <ThreeWays />
      <MeetLeafy />
      <Remembers />
      <FoggySignal />
      <PrivacyChapter />
      <Shortcuts />
      <Faq />
      <Closing />
    </main>
  );
}
