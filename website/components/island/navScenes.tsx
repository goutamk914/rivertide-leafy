'use client';

import Link from 'next/link';
import { ArrowUpRight, Download, X } from 'lucide-react';
import type { MotionValue } from 'motion/react';
import type { IslandScene, IslandSize, IslandSizes } from '@rivertide/island';
import { DOWNLOAD_URL, NAV_LINKS } from '@/lib/site';
import { IslandLeafy, IslandText, ProgressRing } from './IslandBits';

export const ISLAND_HEIGHT = 36;
export const LABEL_FONT = '500 13.5px "Inter Variable"';

/** Pill padding (the island uses 28% of the height) plus Leafy and the gap beside it. */
const PAD = Math.round(ISLAND_HEIGHT * 0.28);
const LEAFY_WIDTH = 24;
const ROW_GAP = 8;
/** Progress ring (18) + gap (5) + "100%" in 11px mono. */
const PROGRESS_WIDTH = 18 + 5 + 28;
const MENU_HEIGHT = 224;
const MENU_MAX_WIDTH = 360;
const MENU_MARGIN = 24;

export function siteIslandSizes(small: boolean): Partial<IslandSizes> {
  return {
    compact: { width: 124, height: ISLAND_HEIGHT },
    stretched: { width: 220, height: ISLAND_HEIGHT },
    bubble: small ? 32 : 36,
    radius: 28,
  };
}

export function menuSize(viewportWidth: number): IslandSize {
  return { width: Math.min(MENU_MAX_WIDTH, viewportWidth - MENU_MARGIN), height: MENU_HEIGHT };
}

const leafyRow = (label: string, mood: 'idle' | 'greeting' = 'idle') => (
  <span className="rt-island-row">
    <IslandLeafy mood={mood} />
    <IslandText>{label}</IslandText>
  </span>
);

/** Resting: Leafy and the name, nothing else. */
export function restScene(labelWidth: number): IslandScene {
  return {
    id: 'rest',
    mode: 'compact',
    size: { width: PAD * 2 + LEAFY_WIDTH + ROW_GAP + labelWidth + 2, height: ISLAND_HEIGHT },
    leading: leafyRow('Rivertide'),
  };
}

/** Scrolling: the chapter you are in, and how far down the page you are. */
export function chapterScene(chapter: string, labelWidth: number, progress: MotionValue<number>, maxWidth: number): IslandScene {
  const width = PAD * 3 + LEAFY_WIDTH + ROW_GAP + labelWidth + PROGRESS_WIDTH + 2;
  return {
    id: `chapter:${chapter}`,
    mode: 'stretched',
    size: { width: Math.min(width, maxWidth), height: ISLAND_HEIGHT },
    leading: leafyRow(chapter),
    trailing: <ProgressRing progress={progress} />,
  };
}

interface MenuSceneOptions {
  readonly size: IslandSize;
  readonly menuId: string;
  readonly onNavigate: () => void;
}

/** Open: the site's pages and the download, in a card that grew out of the pill. */
export function menuScene({ size, menuId, onNavigate }: MenuSceneOptions): IslandScene {
  return {
    id: 'menu',
    mode: 'large',
    size,
    body: (
      <div className="rt-menu" id={menuId}>
        <div className="rt-menu__head" aria-hidden="true">
          {leafyRow('Rivertide', 'greeting')}
          <X size={16} strokeWidth={1.75} className="rt-menu__close" />
        </div>
        <ul className="rt-menu__links">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="rt-menu__link" onClick={onNavigate}>
                <span>{link.label}</span>
                <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <a href={DOWNLOAD_URL} className="rt-menu__cta" onClick={onNavigate}>
          <Download size={16} strokeWidth={1.75} aria-hidden="true" />
          Download for Mac
        </a>
      </div>
    ),
  };
}
