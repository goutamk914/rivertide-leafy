/**
 * Tool policy (pure). Effective policy = the user's per-tool override (always / ask / never),
 * else the risk default: read and act run, confirm asks.
 *
 * Injection guard: once a run has read untrusted content (files, documents, notes, clipboard…),
 * tools that send model-chosen data off the machine ask first unless the user said "always".
 */
import type { Settings } from '../../shared/settings';
import type { ToolRisk } from './tools/types';

export type EffectivePolicy = 'run' | 'ask' | 'block';
type Override = Settings['agent']['toolPolicy'][string];

export interface PolicyTool {
  readonly name: string;
  readonly risk: ToolRisk;
  readonly egress?: boolean;
}

export function riskDefault(risk: ToolRisk): EffectivePolicy {
  return risk === 'confirm' ? 'ask' : 'run';
}

export function effectivePolicy(tool: PolicyTool, overrides: Readonly<Record<string, Override>>, tainted = false): EffectivePolicy {
  const override = overrides[tool.name];
  if (override === 'never') return 'block';
  if (override === 'ask') return 'ask';
  if (override === 'always') return 'run';
  const base = riskDefault(tool.risk);
  return base === 'run' && tainted && tool.egress ? 'ask' : base;
}
