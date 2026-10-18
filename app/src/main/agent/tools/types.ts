/**
 * Agent tool contract. Each tool: name, description (when to use it), risk level, zod schema,
 * a short title for the UI, and `run` → `{ ok, summary, data? }`. Summaries are written to be
 * spoken aloud ("Opened Calendar.").
 */
import type { z } from 'zod';
import type { AgentRunSource } from '../../../shared/types';
import type { AppContext, FileHit } from '../../services';
import type { OsExtras } from '../../os/extras';
import { osErrorMessage } from '../../os/errors';

export type ToolRisk = 'read' | 'act' | 'confirm';

export interface ToolOutcome {
  readonly ok: boolean;
  /** One or two plain sentences, safe to speak. */
  readonly summary: string;
  /** Structured details for the model (never shown verbatim to the user). */
  readonly data?: unknown;
}

/** Items a follow-up like "open the second one" can refer to. */
export type RememberedItems =
  | { readonly kind: 'files'; readonly items: readonly FileHit[] }
  | { readonly kind: 'apps'; readonly items: readonly { readonly name: string; readonly path: string }[] };

export interface ToolContext {
  readonly app: AppContext;
  /** Platform extras (system controls, media…); null when the OS layer doesn't provide them. */
  readonly os: OsExtras | null;
  readonly now: () => Date;
  readonly signal: AbortSignal;
  readonly source: AgentRunSource;
  readonly remember: (items: RememberedItems) => void;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  /** Tells the model when to use the tool. */
  readonly description: string;
  readonly risk: ToolRisk;
  readonly schema: S;
  /** Reaches the network with model-chosen data (escalated to "ask" after untrusted content). */
  readonly egress?: boolean;
  /** Returns content from outside the conversation (files, documents, notes, clipboard, web). */
  readonly untrustedOutput?: boolean;
  /** Needs `settings.agent.allowNetworkTools`. */
  readonly network?: boolean;
  /** Short imperative for the island, e.g. "Open Calendar". */
  title(input: z.output<S>): string;
  /** One sentence for confirmations: exactly what will happen. */
  confirmText?(input: z.output<S>): string;
  run(input: z.output<S>, context: ToolContext): Promise<ToolOutcome>;
}

/** Identity helper that keeps each tool's input type tied to its schema. */
export const defineTool = <S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> => tool;

export const ok = (summary: string, data?: unknown): ToolOutcome => ({ ok: true, summary, ...(data === undefined ? {} : { data }) });
export const fail = (summary: string, data?: unknown): ToolOutcome => ({ ok: false, summary, ...(data === undefined ? {} : { data }) });

/** The OS layer's friendly message when there is one, else the fallback (never raw errors). */
export const errorText = (error: unknown, fallback: string): string => osErrorMessage(error, fallback);

/** "a, b or c" */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

/** Shortens long text for the model (tool outputs are capped). */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
