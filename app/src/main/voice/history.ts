/** Builds the HistoryItem for a finished voice session (pure). */
import type { HistoryItem, Id } from '../../shared/types';
import type { CapturePayload } from '../services';
import { countWords } from './feedback';
import type { CaptureSession, PipelineResult } from './pipeline';

export function buildHistoryItem(id: Id, session: CaptureSession, payload: CapturePayload, result: PipelineResult, finishedAt: number): HistoryItem {
  return {
    id,
    createdAt: new Date(session.startedAt).toISOString(),
    mode: session.mode,
    source: session.source,
    status: result.status,
    raw: result.raw,
    output: result.output,
    words: countWords(result.raw),
    durationMs: Math.round(payload.stats.durationMs),
    app: result.app ? { name: result.app.name, bundleId: result.app.bundleId } : null,
    pasted: result.pasted,
    error: result.error && result.status !== 'ok' ? result.error.message : null,
    timings: { sttMs: result.sttMs, llmMs: result.llmMs, totalMs: Math.max(0, finishedAt - session.startedAt) },
    providers: { stt: result.sttProvider, llm: result.llmProvider },
    actions: result.actions,
    audioPath: null,
  };
}
