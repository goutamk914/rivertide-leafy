import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage, ChatSession } from '@shared/types';
import { errorMessage, invoke } from '../../../lib/ipc';
import { useIpcEvent, useIpcQuery } from '../../hooks/useIpc';

export interface StreamState {
  /** Assistant message id once main has told us. */
  readonly messageId: string | null;
  readonly content: string;
  readonly status: 'waiting' | 'streaming' | 'error';
  readonly error: string | null;
  /** The question being answered, for Retry. */
  readonly question: string;
  /** The user message this reply belongs to (local id until main confirms it). */
  readonly userMessageId: string | null;
}

/** Pure reducer for chat stream events (unit-tested). Returns the next stream state and any finished message. */
export function applyChatEvent(stream: StreamState | null, event: ChatEvent): { stream: StreamState | null; finished: ChatMessage | null } {
  if (event.type === 'done') return { stream: null, finished: event.message };
  if (!stream) return { stream, finished: null };
  if (stream.messageId && event.messageId !== stream.messageId) return { stream, finished: null };
  if (event.type === 'error') return { stream: { ...stream, messageId: event.messageId, status: 'error', error: event.message }, finished: null };
  return { stream: { ...stream, messageId: event.messageId, status: 'streaming', content: stream.content + event.delta }, finished: null };
}

function appendUnique(session: ChatSession | null | undefined, sessionId: string, message: ChatMessage): ChatSession | null | undefined {
  if (!session || session.id !== sessionId || session.messages.some((m) => m.id === message.id)) return session;
  return { ...session, messages: [...session.messages, message] };
}

function withoutMessage(session: ChatSession | null | undefined, messageId: string | null): ChatSession | null | undefined {
  if (!session || !messageId) return session;
  return { ...session, messages: session.messages.filter((m) => m.id !== messageId) };
}

export interface ChatController {
  readonly session: ChatSession | null | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
  readonly stream: StreamState | null;
  readonly lastReply: ChatMessage | null;
  readonly send: (text: string) => Promise<boolean>;
  readonly retry: () => void;
}

/** One conversation: loads it, sends messages, and folds streamed `chat:event`s into the view. */
export function useChat(sessionId: string | null): ChatController {
  const query = useIpcQuery(() => (sessionId ? invoke('chat:get', { id: sessionId }) : Promise.resolve(null)), [sessionId], ['chats']);
  // useIpcQuery keeps the previous result while refetching; never show another chat's messages.
  const current = query.data === null || query.data?.id === sessionId ? query.data : undefined;
  const [stream, setStreamState] = useState<StreamState | null>(null);
  const streamRef = useRef<StreamState | null>(null);
  const [lastReply, setLastReply] = useState<ChatMessage | null>(null);
  const { mutate } = query;

  const setStream = useCallback((next: StreamState | null) => {
    streamRef.current = next;
    setStreamState(next);
  }, []);

  useEffect(() => setStream(null), [sessionId, setStream]);

  useIpcEvent('chat:event', (event) => {
    if (event.sessionId !== sessionId) return;
    const next = applyChatEvent(streamRef.current, event);
    setStream(next.stream);
    const finished = next.finished;
    if (finished) {
      mutate((s) => appendUnique(s, event.sessionId, finished));
      setLastReply(finished);
    }
  });

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!sessionId || !trimmed) return false;
      const temp: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: trimmed, createdAt: new Date().toISOString(), citations: [] };
      mutate((s) => appendUnique(s, sessionId, temp));
      setStream({ messageId: null, content: '', status: 'waiting', error: null, question: trimmed, userMessageId: temp.id });
      try {
        const ids = await invoke('chat:send', { sessionId, text: trimmed });
        mutate((s) => (s ? { ...s, messages: s.messages.map((m) => (m.id === temp.id ? { ...m, id: ids.userMessageId } : m)) } : s));
        const pending = streamRef.current;
        if (pending) setStream({ ...pending, messageId: pending.messageId ?? ids.assistantMessageId, userMessageId: ids.userMessageId });
        return true;
      } catch (error) {
        setStream({ messageId: null, content: '', status: 'error', error: `Your message wasn’t sent. ${errorMessage(error)}`, question: trimmed, userMessageId: temp.id });
        return false;
      }
    },
    [sessionId, mutate, setStream],
  );

  /**
   * The contract has no "regenerate" channel, so Retry sends the question again. The failed attempt's
   * user message is removed from this view first so it isn't shown twice. (Main may still have stored
   * the first attempt; it reappears after a reload until a retry channel exists.)
   */
  const retry = useCallback(() => {
    const failed = streamRef.current;
    if (!failed?.question) return;
    mutate((s) => withoutMessage(s, failed.userMessageId));
    void send(failed.question);
  }, [mutate, send]);

  return {
    session: current,
    loading: query.loading || (sessionId !== null && current === undefined),
    error: query.error,
    reload: query.reload,
    stream,
    lastReply,
    send,
    retry,
  };
}
