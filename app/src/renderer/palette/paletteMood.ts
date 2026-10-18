/** Pure: what the little Leafy in the palette header is doing. */
import type { LeafyMood } from '@rivertide/leafy/moods';
import type { VoicePhase } from '@shared/types';
import { activeStep, type AgentRunState } from '../lib/hooks/agentRun';
import { toolActivity } from '../lib/hooks/iconNames';
import type { PaletteView } from './navigation';

export interface PaletteMoodInput {
  readonly view: PaletteView;
  readonly query: string;
  readonly phase: VoicePhase;
  /** The run on screen (current ask turn, or the voice session's run). */
  readonly run: AgentRunState | null;
  /** An ask was sent but its run hasn't reported back yet. */
  readonly waiting: boolean;
}

export function runMood(run: AgentRunState | null, waiting: boolean): LeafyMood {
  if (!run) return waiting ? 'thinking' : 'idle';
  if (run.status === 'done') return 'success';
  if (run.status === 'failed') return 'error';
  if (run.confirmation) return 'confirm';
  const step = activeStep(run);
  if (step) return toolActivity(step.tool);
  return run.text ? 'speaking' : 'thinking';
}

const VOICE_MOODS: Readonly<Partial<Record<VoicePhase, LeafyMood>>> = {
  listening: 'listening',
  transcribing: 'thinking',
  thinking: 'thinking',
  acting: 'working',
  confirming: 'confirm',
  speaking: 'speaking',
  done: 'success',
  error: 'error',
};

export function paletteMood({ view, query, phase, run, waiting }: PaletteMoodInput): LeafyMood {
  if (view === 'ask') return runMood(run, waiting);
  if (view === 'voice') return run && phase !== 'listening' ? runMood(run, false) : VOICE_MOODS[phase] ?? 'idle';
  return query.trim() ? 'searching' : 'idle';
}
