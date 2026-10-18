import { useEffect, useRef } from 'react';
import { ArrowUpRight, BookOpen, Brain, History, RotateCcw, StickyNote } from 'lucide-react';
import { LeafySprite } from '@rivertide/leafy';
import type { ChatMessage, Citation } from '@shared/types';
import { Button, ICON_STROKE, Spinner, SkeletonList } from '../../../ui/components';
import { usePresentation } from '../../app-context';
import type { StreamState } from './useChat';

export const STARTERS = [
  'What did I tell you about my energy this week?',
  'Summarize my notes from the last appointment',
  'What questions should I ask at my next visit?',
] as const;

const CITATION_ICON = { document: BookOpen, fact: Brain, history: History, note: StickyNote } as const;

export function citationHref(citation: Citation): string {
  if (citation.kind === 'document') return `#/documents/${citation.id}`;
  if (citation.kind === 'note') return `#/notes/${citation.id}`;
  if (citation.kind === 'history') return `#/history/${citation.id}`;
  return '#/knowledge/facts';
}

function Sources({ citations }: { readonly citations: readonly Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="chat-sources" aria-label="Sources">
      {citations.map((c) => {
        const Icon = CITATION_ICON[c.kind];
        return (
          <li key={`${c.kind}-${c.id}`}>
            <a className="chat-source" href={citationHref(c)} title={c.snippet}>
              <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
              <span>{c.title}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Message({ message }: { readonly message: ChatMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={`chat-msg chat-msg--${message.role}`}>
      <span className="visually-hidden">{mine ? 'You said:' : 'Leafy said:'}</span>
      <div className="chat-msg__bubble">{message.content}</div>
      {mine ? null : <Sources citations={message.citations} />}
    </div>
  );
}

function Streaming({ stream, onRetry }: { readonly stream: StreamState; readonly onRetry: () => void }) {
  const { reduceMotion } = usePresentation();
  if (stream.status === 'error') {
    return (
      <div className="chat-error" role="alert">
        <p>{stream.error}</p>
        <Button size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="chat-msg chat-msg--assistant" aria-busy="true">
      <div className="chat-msg__who">
        <LeafySprite mood={stream.content ? 'speaking' : 'thinking'} scale={1} reducedMotion={reduceMotion} decorative />
        {stream.content ? 'Leafy is answering' : <span className="chat-thinking"><Spinner /> Leafy is thinking</span>}
      </div>
      {stream.content ? <div className="chat-msg__bubble">{stream.content}</div> : null}
    </div>
  );
}

export interface ChatThreadProps {
  readonly messages: readonly ChatMessage[] | undefined;
  readonly loading: boolean;
  readonly stream: StreamState | null;
  readonly lastReply: ChatMessage | null;
  readonly onStarter: (text: string) => void;
  readonly onRetry: () => void;
}

/** Message list with streaming reply; keeps the newest content in view while the user is at the bottom. */
export function ChatThread({ messages, loading, stream, lastReply, onStarter, onRetry }: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = messages?.length ?? 0;

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, stream?.content, stream?.status]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div ref={scroller} className="chat-thread" onScroll={onScroll}>
      <div className="chat-thread__inner">
        {loading && !messages ? <SkeletonList rows={3} height={64} label="Loading conversation" /> : null}
        {!loading && count === 0 && !stream ? (
          <div className="chat-empty">
            <LeafySprite pose="think-question" scale={4} decorative />
            <h2 className="chat-empty__title">Ask about anything you’ve told Rivertide</h2>
            <ul className="chat-starters" aria-label="Suggestions">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button type="button" className="chat-starter" onClick={() => onStarter(s)}>
                    {s}
                    <ArrowUpRight className="chat-starter__arrow" size={18} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {messages?.map((m) => <Message key={m.id} message={m} />)}
        {stream ? <Streaming stream={stream} onRetry={onRetry} /> : null}
      </div>
      <p className="visually-hidden" aria-live="polite">{lastReply ? `Leafy replied: ${lastReply.content.slice(0, 240)}` : ''}</p>
    </div>
  );
}
