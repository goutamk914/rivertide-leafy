/** Site-wide constants. Every URL the pages link to lives here. */

/** Base path for GitHub Pages project sites, e.g. "/rivertide-website". Empty for a root deploy. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** Public origin + base path, used for canonical URLs, the sitemap and Open Graph. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://codethecure.github.io${BASE_PATH}`).replace(/\/+$/, '');

/** Scheme + host only. Next adds the base path to metadata image URLs itself, so metadataBase must not. */
export const SITE_ORIGIN = new URL(SITE_URL).origin;

export const SITE_NAME = 'Rivertide';
export const SITE_TAGLINE = 'You speak naturally. Rivertide writes clearly.';
export const SITE_DESCRIPTION =
  'A free, open-source voice companion for Mac from Code the Cure. Hold one key and talk; Rivertide types the sentence you meant. Made for chemo brain and brain fog.';

export const REPO_URL = 'https://github.com/CodeTheCure/rivertide-electron';
export const DOWNLOAD_URL = `${REPO_URL}/releases`;
export const CTC_URL = 'https://codethecure.org';

/**
 * Prefixes a root-relative asset path with the base path. next/link adds the base path to page
 * links by itself; plain <img src>, <a href> to files and metadata strings do not.
 */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  return `${BASE_PATH}${path}`;
}

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** Pages reachable from the island menu and the footer. */
export const NAV_LINKS: readonly NavLink[] = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/leafy/', label: 'Leafy' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/download/', label: 'Install guide' },
];
