import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/types';
import {
  activeStep,
  emptyRun,
  EMPTY_RUN_BOOK,
  recordAgentEvent,
  reduceAgentRun,
  RUN_BOOK_SIZE,
  type RunBook,
} from '../../../src/renderer/lib/hooks/agentRun';

const fold = (runId: string, events: readonly AgentEvent[]) => events.reduce(reduceAgentRun, emptyRun(runId));

const confirmation = { runId: 'r1', callId: 'c2', tool: 'quit_app', title: 'Quit Spotify', summary: 'Spotify will close.' };

describe('reduceAgentRun', () => {
  it('records the input and source from run-start', () => {
    // Arrange + Act
    const run = fold('r1', [{ type: 'run-start', runId: 'r1', input: 'open calendar', source: 'palette' }]);

    // Assert
    expect(run.input).toBe('open calendar');
    expect(run.source).toBe('palette');
    expect(run.status).toBe('running');
  });

  it('concatenates streamed text deltas in order', () => {
    const run = fold('r1', [
      { type: 'text', runId: 'r1', delta: 'Your timer ' },
      { type: 'text', runId: 'r1', delta: 'is set.' },
    ]);

    expect(run.text).toBe('Your timer is set.');
  });

  it('tracks a tool step from start to a successful end with its summary', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'set_timer', title: 'Setting a timer' },
      { type: 'tool-end', runId: 'r1', callId: 'c1', ok: true, summary: 'Timer set for 10 minutes' },
    ]);

    expect(run.steps).toEqual([{ callId: 'c1', tool: 'set_timer', title: 'Setting a timer', status: 'ok', summary: 'Timer set for 10 minutes' }]);
  });

  it('marks a failed tool step and treats an empty summary as none', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'open_app', title: 'Opening Zoom' },
      { type: 'tool-end', runId: 'r1', callId: 'c1', ok: false, summary: '' },
    ]);

    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].summary).toBeNull();
  });

  it('holds a pending confirmation until that tool ends', () => {
    const pending = fold('r1', [{ type: 'tool-confirm', runId: 'r1', confirmation }]);
    const answered = reduceAgentRun(pending, { type: 'tool-end', runId: 'r1', callId: 'c2', ok: true, summary: 'Quit Spotify' });

    expect(pending.confirmation).toEqual(confirmation);
    expect(answered.confirmation).toBeNull();
  });

  it('keeps an unrelated confirmation when a different tool ends', () => {
    const pending = fold('r1', [{ type: 'tool-confirm', runId: 'r1', confirmation }]);
    const other = reduceAgentRun(pending, { type: 'tool-end', runId: 'r1', callId: 'other', ok: true, summary: '' });

    expect(other.confirmation).toEqual(confirmation);
  });

  it('settles running steps and prefers the final text at run-end', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'web_search', title: 'Searching the web' },
      { type: 'text', runId: 'r1', delta: 'partial' },
      { type: 'run-end', runId: 'r1', text: 'Final answer.', ok: true },
    ]);

    expect(run.status).toBe('done');
    expect(run.text).toBe('Final answer.');
    expect(run.steps[0].status).toBe('ok');
  });

  it('keeps the streamed text when run-end carries none, and fails running steps on failure', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'web_search', title: 'Searching the web' },
      { type: 'text', runId: 'r1', delta: 'Streamed so far' },
      { type: 'run-end', runId: 'r1', text: '  ', ok: false },
    ]);

    expect(run.status).toBe('failed');
    expect(run.text).toBe('Streamed so far');
    expect(run.steps[0].status).toBe('failed');
  });

  it('ignores events that belong to another run', () => {
    const run = emptyRun('r1');

    const next = reduceAgentRun(run, { type: 'text', runId: 'r2', delta: 'nope' });

    expect(next).toBe(run);
  });

  it('replaces a step that starts again with the same call id', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'open_app', title: 'Opening Notes' },
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'open_app', title: 'Opening Notes again' },
    ]);

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].title).toBe('Opening Notes again');
  });
});

describe('activeStep', () => {
  it('returns the latest running step, or null', () => {
    const run = fold('r1', [
      { type: 'tool-start', runId: 'r1', callId: 'c1', tool: 'a', title: 'A' },
      { type: 'tool-end', runId: 'r1', callId: 'c1', ok: true, summary: '' },
      { type: 'tool-start', runId: 'r1', callId: 'c2', tool: 'b', title: 'B' },
    ]);

    expect(activeStep(run)?.callId).toBe('c2');
    expect(activeStep(null)).toBeNull();
    expect(activeStep(emptyRun('x'))).toBeNull();
  });
});

describe('recordAgentEvent', () => {
  it('records runs from their first event, even before run-start', () => {
    // Arrange
    const events: AgentEvent[] = [
      { type: 'text', runId: 'r1', delta: 'Hello' },
      { type: 'run-start', runId: 'r1', input: 'hi', source: 'palette' },
    ];

    // Act
    const book = events.reduce<RunBook>((b, e) => recordAgentEvent(b, e), EMPTY_RUN_BOOK);

    // Assert
    expect(book.runs.get('r1')?.text).toBe('Hello');
    expect(book.latest).toBe('r1');
  });

  it('follows only accepted sources for latest', () => {
    const accept = (source: string) => source === 'voice';
    const a = recordAgentEvent(EMPTY_RUN_BOOK, { type: 'run-start', runId: 'v1', input: 'x', source: 'voice' }, accept);
    const b = recordAgentEvent(a, { type: 'run-start', runId: 'p1', input: 'y', source: 'palette' }, accept);

    expect(b.latest).toBe('v1');
    expect(b.runs.has('p1')).toBe(true);
  });

  it('evicts the oldest runs beyond the book size without mutating the previous book', () => {
    let book: RunBook = EMPTY_RUN_BOOK;
    for (let i = 0; i <= RUN_BOOK_SIZE; i += 1) {
      book = recordAgentEvent(book, { type: 'run-start', runId: `r${i}`, input: '', source: 'leafy' });
    }
    const before = book;

    const after = recordAgentEvent(book, { type: 'text', runId: 'r5', delta: '!' });

    expect(book.order).toHaveLength(RUN_BOOK_SIZE);
    expect(book.runs.has('r0')).toBe(false);
    expect(after.runs.get('r5')?.text).toBe('!');
    expect(before.runs.get('r5')?.text).toBe('');
  });
});
