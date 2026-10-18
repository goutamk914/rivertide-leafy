'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const TARGETS = '.rt-reveal:not(.is-visible), .rt-doodle:not(.is-drawn)';

/**
 * One observer for the whole site: reveals (10px rise, 700ms, once) and line doodles (draw in
 * once). Server components only add the class; this marks them as they enter the viewport.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(TARGETS));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.classList.add(element.classList.contains('rt-doodle') ? 'is-drawn' : 'is-visible');
          observer.unobserve(element);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
