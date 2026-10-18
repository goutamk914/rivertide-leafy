import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import './globals.css';
import { IslandProvider } from '@/components/island/IslandProvider';
import { SiteIsland } from '@/components/island/SiteIsland';
import { Footer } from '@/components/site/Footer';
import { MotionProvider } from '@/components/site/MotionProvider';
import { RevealObserver } from '@/components/site/RevealObserver';
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TAGLINE } from '@/lib/site';
import { OG_IMAGE } from '@/lib/metadata';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: `${SITE_NAME}: ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Code the Cure', url: 'https://codethecure.org' }],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: '#0b0c0b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

/** Marks the document as scripted before first paint, so reveal styles never hide content without JS. */
const JS_FLAG = "document.documentElement.classList.add('js')";

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
      </head>
      <body>
        <a href="#main" className="rt-skip">
          Skip to content
        </a>
        <MotionProvider>
          <IslandProvider>
            <SiteIsland />
            {children}
          </IslandProvider>
          <Footer />
        </MotionProvider>
        <RevealObserver />
        <div className="rt-grain" aria-hidden="true" />
      </body>
    </html>
  );
}
