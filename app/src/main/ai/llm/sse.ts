/**
 * Server-sent-events parsing for OpenAI-compatible `/chat/completions` streams (pure, no network).
 * `parseSse` turns raw bytes into `data:` payloads; `accumulateChatStream` folds the JSON chunks
 * into text, tool calls and a finish reason.
 */
import { z } from 'zod';

const MAX_EVENT_CHARS = 2_000_000;

/** Yields each event's `data` payload (multi-line data joined with "\n"); stops at `[DONE]`. */
export async function* parseSse(source: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (buffer.length > MAX_EVENT_CHARS) throw new Error('stream event too large');
    const events = buffer.replace(/\r\n?/g, '\n').split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const data = dataOf(event);
      if (data === '[DONE]') return;
      if (data !== null) yield data;
    }
  }
  const tail = dataOf(buffer + decoder.decode());
  if (tail !== null && tail !== '[DONE]') yield tail;
}

function dataOf(event: string): string | null {
  const lines = event.split('\n').filter((line) => line.startsWith('data:'));
  if (lines.length === 0) return null;
  return lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n');
}

const ToolCallDelta = z.object({
  index: z.number().int().nonnegative().optional(),
  id: z.string().optional().nullable(),
  function: z.object({ name: z.string().optional().nullable(), arguments: z.string().optional().nullable() }).optional().nullable(),
});

export const ChatChunkSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    delta: z.object({
      content: z.string().optional().nullable(),
      tool_calls: z.array(ToolCallDelta).optional().nullable(),
    }).optional().nullable(),
    finish_reason: z.string().optional().nullable(),
  })).optional(),
  error: z.object({ message: z.string().optional() }).passthrough().optional(),
});

export interface StreamedToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface AccumulatedStream {
  readonly text: string;
  readonly toolCalls: readonly StreamedToolCall[];
  readonly finishReason: string | null;
  readonly model: string | null;
}

interface MutableCall { id: string; name: string; arguments: string }

/** Folds parsed chunks into the final message. Tool-call fragments are merged by `index`. */
export async function accumulateChatStream(
  payloads: AsyncIterable<string>,
  onDelta: (delta: string) => void,
): Promise<AccumulatedStream> {
  let text = '';
  let finishReason: string | null = null;
  let model: string | null = null;
  const calls = new Map<number, MutableCall>();
  for await (const payload of payloads) {
    const parsed = ChatChunkSchema.safeParse(safeJson(payload));
    if (!parsed.success) continue; // keep-alive comments or vendor extras
    if (parsed.data.error) throw new Error(parsed.data.error.message ?? 'stream error');
    model = parsed.data.model ?? model;
    for (const choice of parsed.data.choices ?? []) {
      const delta = choice.delta?.content ?? '';
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      mergeToolCalls(calls, choice.delta?.tool_calls ?? []);
      finishReason = choice.finish_reason ?? finishReason;
    }
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ ...call }));
  return { text, toolCalls, finishReason, model };
}

function mergeToolCalls(calls: Map<number, MutableCall>, deltas: readonly z.infer<typeof ToolCallDelta>[]): void {
  deltas.forEach((delta, position) => {
    const index = delta.index ?? position;
    const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
    calls.set(index, {
      id: delta.id || current.id,
      name: current.name || (delta.function?.name ?? ''),
      arguments: current.arguments + (delta.function?.arguments ?? ''),
    });
  });
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // callers treat undefined as "not JSON"
  }
}
