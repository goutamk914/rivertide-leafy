/**
 * Chat sessions with Leafy. `send` stores the user's message, resolves immediately with both
 * message ids, then streams the answer as `chat:event` deltas and finishes with `done` (the
 * assistant message is saved with citations) or `error` (nothing partial is saved).
 */
import type { ChatMessage, ChatSession, ChatSummary, Id } from '../../shared/types';
import type { AppContext, ChatService } from '../services';
import { newId, nowIso } from '../data/ids';
import { ChatSessionSchema } from '../data/schemas';
import { announceChange, errorMessage, lazyLogger, lazyStore, parseItems, truncate } from '../data/store';
import { bestWindow } from '../knowledge/passages';
import { tokenize } from '../knowledge/text';
import {
  autoTitle, buildTurnMessages, CHAT_SYSTEM_PROMPT, DEFAULT_CHAT_TITLE, MAX_PASSAGE_CHARS, toCitation, type Passage,
} from './context';

interface ChatsFile { readonly version: 1; readonly sessions: readonly ChatSession[] }

export const CHATS_CAP = 200;
export const CONTEXT_FACTS = 10;
export const CONTEXT_HITS = 4;
const CHAT_TIMEOUT_MS = 120_000;
// Thinking (Claude) and reasoning (gpt-oss) tokens count toward this budget.
const CHAT_MAX_TOKENS = 8000;
const PREVIEW_CHARS = 100;

const MESSAGES = {
  missing: 'That chat no longer exists. Start a new one.',
  busy: 'Leafy is still answering. Wait a moment, then send your message.',
  notConfigured: 'Chat needs an AI provider. Add one in Settings, then try again.',
  timeout: 'Leafy took too long to answer. Please try again.',
  failed: "Leafy couldn't answer just now. Check your internet connection or AI settings, then try again.",
} as const;

const byRecent = (a: ChatSession, b: ChatSession): number => b.updatedAt.localeCompare(a.updatedAt);

export function summarize(session: ChatSession): ChatSummary {
  const last = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    preview: last ? truncate(last.content, PREVIEW_CHARS) : '',
    messageCount: session.messages.length,
  };
}

export function createChatService(ctx: AppContext): ChatService {
  const log = lazyLogger(ctx, 'chat');
  const store = lazyStore<ChatsFile>(ctx, 'chats', { version: 1, sessions: [] }, (raw) => ({
    version: 1,
    sessions: parseItems(raw, 'sessions', ChatSessionSchema, log),
  }));
  const inFlight = new Map<Id, AbortController>();

  const sessions = (): readonly ChatSession[] => store().read().sessions;
  const find = (id: Id): ChatSession | null => sessions().find((session) => session.id === id) ?? null;
  const write = (next: readonly ChatSession[]): void => {
    store().write({ version: 1, sessions: [...next].sort(byRecent).slice(0, CHATS_CAP) });
    announceChange(ctx, 'chats');
  };
  const save = (session: ChatSession): void => write([session, ...sessions().filter((s) => s.id !== session.id)]);

  const passageText = (kind: Passage['kind'], id: Id): string | null => {
    if (kind === 'document') return ctx.documents.get(id)?.text ?? null;
    if (kind === 'note') {
      const note = ctx.notes.list().find((entry) => entry.id === id);
      return note ? `${note.title}\n${note.body}` : null;
    }
    if (kind === 'history') {
      const item = ctx.history.get(id);
      return item ? [item.raw, item.output].filter((part) => part.trim()).join('\n') : null;
    }
    return null;
  };

  const gatherContext = (text: string): { facts: ReturnType<AppContext['knowledge']['relevant']>; passages: Passage[] } => {
    try {
      const terms = new Set(tokenize(text));
      const hits = ctx.search.search(text, { kinds: ['document', 'note', 'history'], limit: CONTEXT_HITS });
      const passages = hits.map((hit): Passage => ({
        kind: hit.kind, id: hit.id, title: hit.title,
        text: bestWindow(passageText(hit.kind, hit.id) ?? hit.snippet, terms, MAX_PASSAGE_CHARS),
      }));
      return { facts: ctx.knowledge.relevant(text, CONTEXT_FACTS), passages };
    } catch (error) {
      log().error('Could not gather chat context; answering without it', { error: errorMessage(error) });
      return { facts: [], passages: [] };
    }
  };

  const fail = (sessionId: Id, messageId: Id, message: string): void => {
    ctx.bus.emit('chat:event', { type: 'error', sessionId, messageId, message });
  };

  const runTurn = async (sessionId: Id, userMessage: ChatMessage, messageId: Id, controller: AbortController): Promise<void> => {
    if (!ctx.llm.isConfigured('chat')) return fail(sessionId, messageId, MESSAGES.notConfigured);
    const session = find(sessionId);
    if (!session) return;
    const { facts, passages } = gatherContext(userMessage.content);
    const previous = session.messages.filter((message) => message.id !== userMessage.id);
    const timeout = AbortSignal.timeout(CHAT_TIMEOUT_MS);
    let streamed = '';
    try {
      const result = await ctx.llm.stream('chat', {
        system: CHAT_SYSTEM_PROMPT,
        messages: buildTurnMessages({ previous, text: userMessage.content, facts, passages }),
        maxTokens: CHAT_MAX_TOKENS,
        signal: AbortSignal.any([controller.signal, timeout]),
      }, (delta) => {
        streamed += delta;
        ctx.bus.emit('chat:event', { type: 'delta', sessionId, messageId, delta });
      });
      const content = (result.text || streamed).trim();
      if (!content) throw new Error('The model returned an empty reply.');
      const message: ChatMessage = { id: messageId, role: 'assistant', content, createdAt: nowIso(), citations: passages.map(toCitation) };
      const latest = find(sessionId);
      if (latest) save({ ...latest, messages: [...latest.messages, message], updatedAt: message.createdAt });
      ctx.bus.emit('chat:event', { type: 'done', sessionId, message });
    } catch (error) {
      if (controller.signal.aborted) return;
      log().warn('Chat turn failed', { sessionId, error: errorMessage(error) });
      fail(sessionId, messageId, timeout.aborted ? MESSAGES.timeout : MESSAGES.failed);
    }
  };

  return {
    list: () => [...sessions()].sort(byRecent).map(summarize),
    get: find,

    create() {
      const now = nowIso();
      const session: ChatSession = { id: newId(), title: DEFAULT_CHAT_TITLE, createdAt: now, updatedAt: now, messages: [] };
      save(session);
      return session;
    },

    rename(id, title) {
      const session = find(id);
      if (!session) throw new Error(MESSAGES.missing);
      const renamed: ChatSession = { ...session, title: title.trim().slice(0, 120) || DEFAULT_CHAT_TITLE, updatedAt: nowIso() };
      save(renamed);
      return summarize(renamed);
    },

    delete(id) {
      inFlight.get(id)?.abort();
      const current = sessions();
      const kept = current.filter((session) => session.id !== id);
      if (kept.length !== current.length) write(kept);
    },

    async send(sessionId, text) {
      const session = find(sessionId);
      if (!session) throw new Error(MESSAGES.missing);
      if (inFlight.has(sessionId)) throw new Error(MESSAGES.busy);
      const now = nowIso();
      const content = text.trim();
      // A retry re-sends the last question after a failed reply; reuse it instead of storing it twice.
      const last = session.messages[session.messages.length - 1];
      const isRetry = last?.role === 'user' && last.content === content;
      const userMessage: ChatMessage = isRetry && last
        ? last
        : { id: newId(), role: 'user', content, createdAt: now, citations: [] };
      if (!isRetry) {
        const isFirst = !session.messages.some((message) => message.role === 'user');
        const title = isFirst && session.title === DEFAULT_CHAT_TITLE ? autoTitle(content) : session.title;
        save({ ...session, title, messages: [...session.messages, userMessage], updatedAt: now });
      }
      const assistantMessageId = newId();
      const controller = new AbortController();
      inFlight.set(sessionId, controller);
      setImmediate(() => {
        runTurn(sessionId, userMessage, assistantMessageId, controller)
          .catch((error: unknown) => {
            log().error('Unexpected chat failure', { sessionId, error: errorMessage(error) });
            fail(sessionId, assistantMessageId, MESSAGES.failed);
          })
          .finally(() => inFlight.delete(sessionId));
      });
      return { userMessageId: userMessage.id, assistantMessageId };
    },
  };
}
