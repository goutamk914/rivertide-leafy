/**
 * Short-term conversation memory: the last exchange stays for 5 minutes so follow-ups work
 * ("open the second one", "and tomorrow?"). The transcript is append-only (replayed thinking
 * blocks must not be edited); when it grows too long it starts fresh instead of trimming.
 */
import type { AgentMessage } from '../ai/llm/types';
import type { RememberedItems } from './tools/types';

export const CONVERSATION_TTL_MS = 5 * 60_000;
export const MAX_CONVERSATION_MESSAGES = 60;

export interface ConversationSnapshot {
  readonly messages: readonly AgentMessage[];
  readonly remembered: RememberedItems | null;
}

export interface ConversationMemory {
  get(): ConversationSnapshot;
  commit(messages: readonly AgentMessage[]): void;
  remember(items: RememberedItems): void;
  reset(): void;
}

const EMPTY: ConversationSnapshot = { messages: [], remembered: null };

export function createConversationMemory(now: () => number = Date.now, ttlMs = CONVERSATION_TTL_MS): ConversationMemory {
  let state: ConversationSnapshot = EMPTY;
  let touchedAt = 0;

  const current = (): ConversationSnapshot => {
    if (now() - touchedAt > ttlMs) state = EMPTY;
    return state;
  };

  return {
    get: current,
    commit(messages) {
      const base = current().messages;
      const combined = base.length + messages.length > MAX_CONVERSATION_MESSAGES ? [...messages] : [...base, ...messages];
      state = { ...state, messages: combined };
      touchedAt = now();
    },
    remember(items) {
      state = { ...current(), remembered: items };
      touchedAt = now();
    },
    reset() {
      state = EMPTY;
      touchedAt = 0;
    },
  };
}
