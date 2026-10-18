import type { FocusEvent, RefObject } from 'react';
import { Ellipsis, Mic, Search, Square } from 'lucide-react';
import type { AudioLevel } from '@shared/types';
import { Waveform } from '../lib/hooks/Waveform';
import type { LeafyLayout } from './layout';
import type { RegionHandlers } from './usePointerRegions';

export type MicState = 'ready' | 'listening' | 'busy';

export interface ToolbarProps {
  readonly box: LeafyLayout['toolbar'];
  readonly visible: boolean;
  readonly micState: MicState;
  readonly levelRef: RefObject<AudioLevel>;
  readonly reducedMotion: boolean;
  /** Human-readable shortcuts, e.g. "⌘⇧L". */
  readonly commandShortcut: string;
  readonly paletteShortcut: string;
  readonly regionHandlers: RegionHandlers;
  readonly onFocusWithin: (focused: boolean) => void;
  readonly onMic: () => void;
  readonly onSearch: () => void;
  readonly onMore: () => void;
}

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

const MIC_LABEL: Readonly<Record<MicState, string>> = {
  ready: 'Talk to Leafy',
  listening: 'Stop listening',
  busy: 'Stop',
};

function Tip({ label, shortcut }: { readonly label: string; readonly shortcut?: string }) {
  return (
    <span className="lf-tip" aria-hidden="true">
      {label}
      {shortcut ? <kbd className="lf-tip__kbd">{shortcut}</kbd> : null}
    </span>
  );
}

function MicGlyph({ state, levelRef, reducedMotion }: Pick<ToolbarProps, 'levelRef' | 'reducedMotion'> & { readonly state: MicState }) {
  if (state === 'listening') return <Waveform levelRef={levelRef} bars={5} barWidth={3} gap={2.5} height={20} reducedMotion={reducedMotion} />;
  if (state === 'busy') return <Square size={14} strokeWidth={2.25} fill="currentColor" aria-hidden />;
  return <Mic {...ICON} />;
}

/**
 * Leafy's hover toolbar: search on the left, a raised mic in the middle (live waveform while
 * listening, stop square while busy), more on the right. Real buttons with labels and shortcuts.
 */
export function Toolbar(props: ToolbarProps) {
  const { box, visible, micState, commandShortcut, paletteShortcut, regionHandlers } = props;
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onFocusWithin(false);
  };
  return (
    <div
      className="lf-toolbar"
      role="toolbar"
      aria-label="Leafy"
      data-visible={visible}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onFocus={() => props.onFocusWithin(true)}
      onBlur={onBlur}
      {...regionHandlers}
    >
      <button type="button" className="lf-tool" aria-label="Search or type" aria-keyshortcuts={paletteShortcut} onClick={props.onSearch}>
        <Search {...ICON} />
        <Tip label="Search or type" shortcut={paletteShortcut} />
      </button>
      <button
        type="button"
        className="lf-tool lf-tool--mic"
        data-state={micState}
        aria-label={MIC_LABEL[micState]}
        aria-pressed={micState === 'listening'}
        aria-keyshortcuts={micState === 'ready' ? commandShortcut : undefined}
        onClick={props.onMic}
      >
        <MicGlyph state={micState} levelRef={props.levelRef} reducedMotion={props.reducedMotion} />
        <Tip label={MIC_LABEL[micState]} shortcut={micState === 'ready' ? commandShortcut : undefined} />
      </button>
      <button type="button" className="lf-tool" aria-label="More" aria-haspopup="menu" onClick={props.onMore}>
        <Ellipsis {...ICON} />
        <Tip label="More" />
      </button>
    </div>
  );
}
