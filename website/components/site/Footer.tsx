import Link from 'next/link';
import { CTC_URL, NAV_LINKS, REPO_URL } from '@/lib/site';
import { CtcMark } from './CtcMark';

/**
 * Code the Cure's footer, Rivertide's name: attribution, a short row of links, and the wordmark
 * set at page width fading into the bottom edge.
 */
export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-bg">
      <div className="rt-container pt-20 md:pt-28">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-16">
          <div>
            <a href={CTC_URL} className="inline-flex items-center gap-3 rounded-full pr-2" aria-label="Built by Code the Cure (codethecure.org)">
              <span className="rt-ctc-disc">
                <CtcMark className="h-6 w-6" />
              </span>
              <span className="font-display text-[15px] font-medium tracking-[-0.01em] text-ink">Built by Code the Cure</span>
            </a>
            <p className="mt-6 max-w-[34ch] text-balance font-display text-[24px] leading-[1.25] tracking-[-0.02em] text-ink md:text-[28px]">
              Free tools for people living with cancer, and the people beside them.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-[repeat(2,minmax(0,max-content))] sm:gap-x-16">
            <nav aria-label="Rivertide">
              <ul className="flex flex-col text-[15px]">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="rt-footer-link">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Elsewhere">
              <ul className="flex flex-col text-[15px]">
                <li>
                  <a href={REPO_URL} className="rt-footer-link">
                    Source on GitHub
                  </a>
                </li>
                <li>
                  <a href={`${REPO_URL}/releases`} className="rt-footer-link">
                    Release notes
                  </a>
                </li>
                <li>
                  <a href={CTC_URL} className="rt-footer-link">
                    codethecure.org
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <p className="mt-16 max-w-[70ch] text-[14px] leading-relaxed text-ink-muted md:mt-24">
          Rivertide is not medical software and does not diagnose anything. Talk to your care team about symptoms.
          This site has no cookies and no analytics. &copy; 2026 Code the Cure.
        </p>
      </div>

      <p aria-hidden="true" className="rt-footer-wordmark pointer-events-none mt-10 whitespace-nowrap text-center">
        Rivertide
      </p>
    </footer>
  );
}
