import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { DOWNLOAD_URL } from '@/lib/site';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The one primary action on the site, same label everywhere. */
export function DownloadButton({ size = 'md' }: { readonly size?: 'md' | 'sm' }) {
  return (
    <a href={DOWNLOAD_URL} className={size === 'sm' ? 'rt-btn rt-btn--primary rt-btn--sm' : 'rt-btn rt-btn--primary'}>
      <Download {...ICON} />
      Download for Mac
    </a>
  );
}

/** A quiet secondary action that stays on the site. */
export function GhostLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <Link href={href} className="rt-btn rt-btn--ghost">
      {children}
      <ArrowRight {...ICON} size={17} />
    </Link>
  );
}
