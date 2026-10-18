'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useScroll } from 'motion/react';
import { DynamicIsland } from '@rivertide/island';
import { useActiveChapter } from '@/lib/hooks/useActiveChapter';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import { useTextWidth } from '@/lib/hooks/useTextWidth';
import { useIslandActivity } from './IslandProvider';
import { LABEL_FONT, chapterScene, menuScene, menuSize, restScene, siteIslandSizes } from './navScenes';

/** How the menu was opened decides what closes it: hover closes on leave, the rest on blur or Esc. */
type OpenedBy = 'hover' | 'focus' | 'click';

const HOVER_OPEN_MS = 90;
const HOVER_CLOSE_MS = 260;
const CHAPTER_MAX_WIDTH = 340;

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange, { passive: true });
  return () => window.removeEventListener('resize', onChange);
}

const readViewportWidth = () => window.innerWidth;
const serverViewportWidth = () => 1280;

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, readViewportWidth, serverViewportWidth);
}

/** Closes the menu on Esc and on any press outside the island. */
function useDismiss(open: boolean, navRef: React.RefObject<HTMLElement | null>, close: (refocus: boolean) => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, navRef, close]);
}

/**
 * The site's navigation is a Dynamic Island. Resting, it is Leafy and the name; while you scroll
 * it stretches to show the chapter and your progress; hover, focus or tap opens it into a menu;
 * demos on the page borrow it for live activities. One persistent button drives the disclosure,
 * so keyboard focus survives every change of shape.
 */
export function SiteIsland() {
  const activity = useIslandActivity();
  const reduced = usePrefersReducedMotion();
  const chapter = useActiveChapter();
  const { scrollYProgress } = useScroll();
  const pathname = usePathname();
  const small = useMediaQuery('(max-width: 400px)');
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const viewport = useViewportWidth();
  const menuId = `${useId()}-menu`;
  const navRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  const open = openedBy !== null;

  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpenedBy(null);
  }

  const close = useCallback((refocus: boolean) => {
    window.clearTimeout(hoverTimer.current);
    setOpenedBy(null);
    if (refocus && navRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
  }, []);

  useDismiss(open, navRef, close);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const onPointerEnter = () => {
    if (!canHover) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpenedBy((current) => current ?? 'hover'), HOVER_OPEN_MS);
  };
  const onPointerLeave = () => {
    if (!canHover) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpenedBy((current) => (current === 'hover' ? null : current)), HOVER_CLOSE_MS);
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const fromOutside = !navRef.current?.contains(event.relatedTarget as Node | null);
    if (fromOutside && event.target.matches(':focus-visible')) setOpenedBy((current) => current ?? 'focus');
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && navRef.current?.contains(next)) return;
    // Focus going nowhere (a click on the card's empty space, switching windows) only closes a
    // menu that focus opened; pointer-opened menus close on leave or an outside press instead.
    setOpenedBy((current) => (next === null && (current === 'click' || current === 'hover') ? current : null));
  };
  const onTrigger = () => {
    window.clearTimeout(hoverTimer.current);
    // Activating a menu that hover or focus opened pins it open; otherwise a click toggles.
    setOpenedBy((current) => (current === 'hover' || current === 'focus' ? 'click' : current ? null : 'click'));
  };

  const restWidth = useTextWidth('Rivertide', LABEL_FONT);
  const chapterWidth = useTextWidth(chapter ?? '', LABEL_FONT);
  const sizes = useMemo(() => siteIslandSizes(small), [small]);
  // Hand focus back to the button before the menu (and the link in it) goes inert.
  const onNavigate = useCallback(() => close(true), [close]);

  const scene = open
    ? menuScene({ size: menuSize(viewport), menuId, onNavigate })
    : (activity ?? (chapter ? chapterScene(chapter, chapterWidth, scrollYProgress, Math.min(CHAPTER_MAX_WIDTH, viewport - 24)) : restScene(restWidth)));

  return (
    <header className="rt-site-header">
      <nav ref={navRef} aria-label="Main" onFocus={onFocus} onBlur={onBlur}>
        <DynamicIsland scene={scene} sizes={sizes} reducedMotion={reduced} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
          <button
            ref={triggerRef}
            type="button"
            className="rt-island-trigger"
            data-open={open}
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={onTrigger}
          >
            <span className="sr-only">Rivertide menu</span>
          </button>
        </DynamicIsland>
      </nav>
    </header>
  );
}
