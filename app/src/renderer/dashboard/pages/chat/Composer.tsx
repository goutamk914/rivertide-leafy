import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { ICON_STROKE, Kbd } from '../../../ui/components';

const MAX_CHARS = 20_000;
const MAX_HEIGHT_PX = 200;

export interface ComposerProps {
  readonly onSend: (text: string) => Promise<boolean>;
  readonly busy: boolean;
  readonly useFn: boolean;
}

/** Enter sends, Shift+Enter adds a line. The draft is kept if sending fails. */
export function Composer({ onSend, busy, useFn }: ComposerProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText('');
    const ok = await onSend(trimmed);
    if (!ok) setText(trimmed);
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="chat-input" className="visually-hidden">Message Leafy</label>
      <textarea
        id="chat-input"
        ref={input}
        className="chat-composer__input"
        rows={1}
        maxLength={MAX_CHARS}
        placeholder="Ask Leafy something"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby="chat-hint"
      />
      <p id="chat-hint" className="chat-composer__hint">
        {useFn ? <>Hold <Kbd>fn</Kbd> to dictate into this box</> : 'Enter sends, Shift+Enter adds a line'}
      </p>
      <span className="chat-composer__send" style={{ position: 'relative' }}>
        <button type="submit" className="chat-send" aria-label="Send" disabled={!text.trim() || busy}>
          <ArrowUp size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </span>
    </form>
  );
}
