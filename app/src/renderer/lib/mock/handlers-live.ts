/** Mock handlers with simulated live events: voice sessions, chat streaming and agent runs. */
import type { ChatMessage, ChatSession, ChatSummary, HistoryItem, VoiceMode, VoiceSnapshot, VoiceSource } from '@shared/types';
import { countWords } from '../format';
import { mockId } from './random';
import { CHAT_STARTER_REPLY, SAMPLE_UTTERANCES } from './samples';
import { OK, notFound, type MockContext, type MockHandlers } from './context';

const LISTEN_MS = 2600;
const LEVEL_EVERY_MS = 90;
const TRANSCRIBE_MS = 700;
const THINK_MS = 900;
const DONE_HOLD_MS = 2800;
const DELTA_EVERY_MS = 45;
const BAND_COUNT = 12;

export const IDLE_SNAPSHOT: VoiceSnapshot = {
  sessionId: null, phase: 'idle', mode: null, source: null, locked: false, startedAt: null,
  transcript: '', output: '', detail: null, pending: null, pasted: false, error: null,
};

type LiveChannels =
  | 'voice:snapshot' | 'voice:start' | 'voice:stop' | 'voice:cancel'
  | 'chat:list' | 'chat:get' | 'chat:create' | 'chat:rename' | 'chat:delete' | 'chat:send'
  | 'agent:ask' | 'agent:confirm' | 'agent:cancel';

function summary(session: ChatSession): ChatSummary {
  const last = session.messages[session.messages.length - 1];
  return { id: session.id, title: session.title, updatedAt: session.updatedAt, preview: last?.content.slice(0, 120) ?? '', messageCount: session.messages.length };
}

function replyFor(text: string): string {
  if (/energy/i.test(text)) return CHAT_STARTER_REPLY;
  if (/question|visit|appointment/i.test(text)) {
    return 'Based on your notes, you might ask: whether the tingling means the dose should change, what the scan showed, and who to call on weekends. You saved these in “Questions for Dr. Ellis.”';
  }
  return 'I looked through your notes, documents and what you have told me. I don’t have anything specific about that yet. You can tell me more, and I’ll remember it for next time.';
}

function voiceSim(ctx: MockContext) {
  let snapshot: VoiceSnapshot = IDLE_SNAPSHOT;
  let token = 0;
  let stopLevelTimer: (() => void) | null = null;

  const publish = (next: VoiceSnapshot) => {
    snapshot = next;
    ctx.emit('voice:snapshot', next);
    return next;
  };
  const stopLevels = () => {
    stopLevelTimer?.();
    stopLevelTimer = null;
  };
  const after = (ms: number, mine: number, fn: () => void) => ctx.schedule(() => { if (mine === token) fn(); }, ms);

  const recordHistory = (mode: VoiceMode, source: VoiceSource, raw: string, output: string) => {
    const item: HistoryItem = {
      id: mockId(), createdAt: ctx.now().toISOString(), mode, source, status: 'ok', raw, output, words: countWords(raw),
      durationMs: LISTEN_MS, app: mode === 'command' ? null : { name: 'Rivertide', bundleId: 'org.codethecure.rivertide' },
      pasted: mode !== 'command', error: null, timings: { sttMs: TRANSCRIBE_MS, llmMs: THINK_MS, totalMs: TRANSCRIBE_MS + THINK_MS },
      providers: { stt: 'groq · whisper-large-v3-turbo', llm: 'anthropic · claude-opus-5-5' }, actions: [], audioPath: null,
    };
    ctx.set((s) => ({ ...s, history: [item, ...s.history] }));
    ctx.emit('data:changed', { domain: 'history' });
  };

  const finish = (): VoiceSnapshot => {
    if (snapshot.phase !== 'listening') return snapshot;
    stopLevels();
    const mine = token;
    const mode = snapshot.mode ?? 'dictate';
    const sample = SAMPLE_UTTERANCES.find((u) => u.mode === mode) ?? SAMPLE_UTTERANCES[0];
    const transcribing = publish({ ...snapshot, phase: 'transcribing', detail: 'Writing down what you said' });
    after(TRANSCRIBE_MS, mine, () => {
      publish({ ...snapshot, phase: mode === 'command' ? 'acting' : 'thinking', transcript: sample?.raw ?? '', detail: mode === 'command' ? 'Setting a timer' : 'Tidying it up' });
      after(THINK_MS, mine, () => {
        publish({ ...snapshot, phase: 'done', output: sample?.output ?? '', pasted: mode !== 'command', detail: mode === 'command' ? 'Done' : 'Pasted' });
        recordHistory(mode, snapshot.source ?? 'dashboard', sample?.raw ?? '', sample?.output ?? '');
        after(DONE_HOLD_MS, mine, () => publish(IDLE_SNAPSHOT));
      });
    });
    return transcribing;
  };

  const start = (mode: VoiceMode, source: VoiceSource): VoiceSnapshot => {
    if (snapshot.phase === 'listening') return snapshot;
    token += 1;
    const mine = token;
    stopLevels();
    stopLevelTimer = ctx.every(() => {
      const level = 0.25 + Math.random() * 0.6;
      ctx.emit('audio:level', { level, bands: Array.from({ length: BAND_COUNT }, () => Math.min(1, level * (0.4 + Math.random() * 0.8))) });
    }, LEVEL_EVERY_MS);
    after(LISTEN_MS, mine, finish);
    return publish({ ...IDLE_SNAPSHOT, sessionId: mockId(), phase: 'listening', mode, source, startedAt: ctx.now().toISOString(), detail: 'Listening' });
  };

  const cancel = (): VoiceSnapshot => {
    token += 1;
    stopLevels();
    return publish(IDLE_SNAPSHOT);
  };

  return { get: () => snapshot, start, stop: finish, cancel };
}

function streamReply(ctx: MockContext, sessionId: string, assistantId: string, text: string) {
  if (/\bfail\b/i.test(text)) {
    ctx.schedule(() => ctx.emit('chat:event', {
      type: 'error', sessionId, messageId: assistantId,
      message: 'Leafy couldn’t reach the AI service. Check your internet connection, then try again.',
    }), 600);
    return;
  }
  const reply = replyFor(text);
  const words = reply.split(/(?<=\s)/);
  words.forEach((word, i) => ctx.schedule(() => ctx.emit('chat:event', { type: 'delta', sessionId, messageId: assistantId, delta: word }), 300 + i * DELTA_EVERY_MS));
  ctx.schedule(() => {
    const message: ChatMessage = {
      id: assistantId, role: 'assistant', content: reply, createdAt: ctx.now().toISOString(),
      citations: [{ kind: 'note', id: 'n-sample', title: 'Questions for Dr. Ellis', snippet: 'Tingling in fingers and toes — dose change?' }],
    };
    ctx.set((s) => ({
      ...s,
      chats: s.chats.map((c) => (c.id === sessionId ? { ...c, updatedAt: message.createdAt, messages: [...c.messages, message] } : c)),
    }));
    ctx.emit('chat:event', { type: 'done', sessionId, message });
    ctx.emit('data:changed', { domain: 'chats' });
  }, 300 + words.length * DELTA_EVERY_MS + 120);
}

export function liveHandlers(ctx: MockContext): Pick<MockHandlers, LiveChannels> {
  const voice = voiceSim(ctx);
  const nowIso = () => ctx.now().toISOString();

  return {
    'voice:snapshot': () => voice.get(),
    'voice:start': ({ mode, source }) => voice.start(mode, source),
    'voice:stop': () => voice.stop(),
    'voice:cancel': () => voice.cancel(),

    'chat:list': () => ctx.get().chats.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    'chat:get': ({ id }) => ctx.get().chats.find((c) => c.id === id) ?? null,
    'chat:create': () => {
      const session: ChatSession = { id: mockId(), title: 'New chat', createdAt: nowIso(), updatedAt: nowIso(), messages: [] };
      ctx.set((s) => ({ ...s, chats: [session, ...s.chats] }));
      ctx.emit('data:changed', { domain: 'chats' });
      return session;
    },
    'chat:rename': ({ id, title }) => {
      const session = ctx.get().chats.find((c) => c.id === id);
      if (!session) throw notFound('chat');
      const renamed = { ...session, title, updatedAt: nowIso() };
      ctx.set((s) => ({ ...s, chats: s.chats.map((c) => (c.id === id ? renamed : c)) }));
      ctx.emit('data:changed', { domain: 'chats' });
      return summary(renamed);
    },
    'chat:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, chats: s.chats.filter((c) => c.id !== id) }));
      ctx.emit('data:changed', { domain: 'chats' });
      return OK;
    },
    'chat:send': ({ sessionId, text }) => {
      const session = ctx.get().chats.find((c) => c.id === sessionId);
      if (!session) throw notFound('chat');
      const user: ChatMessage = { id: mockId(), role: 'user', content: text, createdAt: nowIso(), citations: [] };
      const assistantId = mockId();
      const title = session.messages.length === 0 && session.title === 'New chat' ? text.slice(0, 60) : session.title;
      ctx.set((s) => ({ ...s, chats: s.chats.map((c) => (c.id === sessionId ? { ...c, title, updatedAt: user.createdAt, messages: [...c.messages, user] } : c)) }));
      streamReply(ctx, sessionId, assistantId, text);
      return { userMessageId: user.id, assistantMessageId: assistantId };
    },

    'agent:ask': ({ text, source }) => {
      const runId = mockId();
      const callId = mockId();
      const answer = 'I found two notes about your appointment and added a reminder for Monday at 9 AM.';
      ctx.schedule(() => ctx.emit('agent:event', { type: 'run-start', runId, input: text, source }), 50);
      ctx.schedule(() => ctx.emit('agent:event', { type: 'tool-start', runId, callId, tool: 'search_notes', title: 'Searching your notes' }), 300);
      ctx.schedule(() => ctx.emit('agent:event', { type: 'tool-end', runId, callId, ok: true, summary: 'Found 2 notes' }), 900);
      ctx.schedule(() => ctx.emit('agent:event', { type: 'text', runId, delta: answer }), 1100);
      ctx.schedule(() => ctx.emit('agent:event', { type: 'run-end', runId, text: answer, ok: true }), 1300);
      return { runId };
    },
    'agent:confirm': () => OK,
    'agent:cancel': () => OK,
  };
}
