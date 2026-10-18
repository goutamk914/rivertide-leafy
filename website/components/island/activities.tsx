'use client';

import { Check, CircleHelp, Timer } from 'lucide-react';
import type { IslandScene } from '@rivertide/island';
import { Dots, IslandLeafy, IslandText, Waveform } from './IslandBits';

/**
 * Live activities the demos play on the navigation island, mirroring what the desktop app's
 * island shows: listening, polishing, pasted, nothing heard, asking, and Leafy being summoned.
 * Each differs in shape and motion, not only colour.
 */

const H = 36;

/**
 * The same scene without its spoken label, for demos that already announce their own state in a
 * status region. Keeps screen readers from hearing every step twice.
 */
export const silent = (scene: IslandScene): IslandScene => ({ ...scene, label: undefined });
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export const listeningScene = (mode: 'dictate' | 'ask' = 'dictate'): IslandScene => ({
  id: `listening-${mode}`,
  mode: 'stretched',
  size: { width: mode === 'ask' ? 176 : 190, height: H },
  label: mode === 'ask' ? 'Listening for your question' : 'Listening',
  leading: (
    <span className="rt-island-row">
      <IslandLeafy mood="listening" />
      <IslandText>{mode === 'ask' ? 'Ask' : 'Listening'}</IslandText>
    </span>
  ),
  trailing: <Waveform tone={mode === 'ask' ? 'ask' : 'ink'} />,
});

export const polishingScene = (): IslandScene => ({
  id: 'polishing',
  mode: 'stretched',
  size: { width: 196, height: H },
  label: 'Polishing your words',
  leading: (
    <span className="rt-island-row">
      <IslandLeafy mood="thinking" />
      <IslandText>Polishing</IslandText>
    </span>
  ),
  trailing: <Dots />,
});

export const pastedScene = (where = 'Notes'): IslandScene => ({
  id: 'pasted',
  mode: 'stretched',
  size: { width: 200, height: H },
  label: `Pasted into ${where}`,
  leading: (
    <span className="rt-island-row">
      <span className="rt-island-check">
        <Check {...ICON} size={14} strokeWidth={2.5} />
      </span>
      <IslandText>Pasted</IslandText>
    </span>
  ),
  trailing: <IslandText tone="muted">{where}</IslandText>,
});

export const missedScene = (): IslandScene => ({
  id: 'missed',
  mode: 'stretched',
  size: { width: 214, height: H },
  label: 'Didn’t catch that. Hold fn while you talk.',
  leading: (
    <span className="rt-island-row">
      <CircleHelp {...ICON} />
      <IslandText>Didn’t catch that</IslandText>
    </span>
  ),
});

export const summonScene = (): IslandScene => ({
  id: 'summon',
  mode: 'split',
  size: { width: 168, height: H },
  label: 'Leafy is listening for a command',
  leading: <Waveform tone="accent" />,
  trailing: <IslandText tone="muted">Listening</IslandText>,
  bubble: <IslandLeafy mood="clap" />,
});

export const timerDoneScene = (): IslandScene => ({
  id: 'timer-set',
  mode: 'large',
  size: { width: 320, height: 76 },
  label: 'Timer set for 20 minutes',
  body: (
    <div className="rt-island-result">
      <IslandLeafy mood="success" />
      <div className="rt-island-result__text">
        <span className="rt-island-text rt-island-text--muted">Timer set</span>
        <span className="rt-island-result__value tabular">20:00</span>
      </div>
      <Timer {...ICON} size={20} className="rt-island-result__icon" />
    </div>
  ),
});
