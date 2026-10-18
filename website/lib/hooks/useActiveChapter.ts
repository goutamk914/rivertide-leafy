'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The chapter under the middle of the viewport. Sections opt in with `data-chapter="Name"`.
 * A thin band across the centre of the screen means only one chapter is ever current.
 */
export function useActiveChapter(): string | null {
  const pathname = usePathname();
  const [chapter, setChapter] = useState<string | null>(null);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'));
    if (sections.length === 0) {
      setChapter(null);
      return undefined;
    }
    const inBand = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting) inBand.add(target);
          else inBand.delete(target);
        }
        const current = sections.find((section) => inBand.has(section));
        setChapter(current?.dataset.chapter ?? null);
      },
      { rootMargin: '-49% 0px -49% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [pathname]);

  return chapter;
}
