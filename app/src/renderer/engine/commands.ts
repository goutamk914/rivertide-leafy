/**
 * Runtime validation of `engine:command` payloads from main. The contract type is the source of
 * truth; the schema is checked against it at compile time so the two cannot drift silently.
 */
import { z } from 'zod';
import type { EngineCommand } from '@shared/ipc';

const requestIdSchema = z.string().min(1).max(64);
const CUE_NAMES = ['start', 'stop', 'success', 'error', 'clap', 'confirm', 'reminder'] as const;

export const EngineCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    requestId: requestIdSchema,
    deviceId: z.string().max(400).nullable(),
    endpointing: z.object({
      enabled: z.boolean(),
      endSilenceMs: z.number().nonnegative().max(60_000),
      noSpeechTimeoutMs: z.number().nonnegative().max(3_600_000),
    }),
    maxDurationMs: z.number().positive().max(3_600_000),
  }),
  z.object({ type: z.literal('stop'), requestId: requestIdSchema }),
  z.object({ type: z.literal('cancel'), requestId: requestIdSchema }),
  z.object({ type: z.literal('clap'), enabled: z.boolean(), sensitivity: z.enum(['low', 'medium', 'high']) }),
  z.object({ type: z.literal('wake'), enabled: z.boolean(), deviceId: z.string().max(400).nullable() }),
  z.object({ type: z.literal('activity'), userActive: z.boolean() }),
  z.object({ type: z.literal('speak'), text: z.string().max(100_000), voiceName: z.string().max(400).nullable(), rate: z.number().min(0.1).max(10) }),
  z.object({ type: z.literal('stop-speaking') }),
  z.object({ type: z.literal('cue'), name: z.enum(CUE_NAMES) }),
]);

type Parsed = z.infer<typeof EngineCommandSchema>;
// Compile-time guards: every parsed command is a contract command and vice versa.
const parsedIsContract = (c: Parsed): EngineCommand => c;
const contractIsParsed = (c: EngineCommand): Parsed => c;
void parsedIsContract;
void contractIsParsed;

export type StartCommand = Extract<EngineCommand, { type: 'start' }>;
export type CueName = Extract<EngineCommand, { type: 'cue' }>['name'];

export type ParseResult = { readonly ok: true; readonly command: EngineCommand } | { readonly ok: false; readonly message: string };

/** The requestId of a `start` that failed validation, so main still gets an answer for it. */
export function rejectedStartId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, requestId } = raw as { type?: unknown; requestId?: unknown };
  return type === 'start' && requestId !== undefined ? requestIdSchema.safeParse(requestId).data ?? null : null;
}

export function parseCommand(raw: unknown): ParseResult {
  const result = EngineCommandSchema.safeParse(raw);
  if (result.success) return { ok: true, command: result.data };
  const issue = result.error.issues[0];
  return { ok: false, message: `Ignored an invalid engine command (${issue?.path.join('.') || 'payload'}: ${issue?.message ?? 'invalid'}).` };
}
