import { useMemo, useState } from 'react';
import { CircleCheck, CircleX, ClipboardPaste, Copy, Trash2 } from 'lucide-react';
import type { HistoryItem } from '@shared/types';
import { formatCount, formatDateTime, formatDuration } from '../../../lib/format';
import { errorMessage, invoke } from '../../../lib/ipc';
import { Button, ICON_STROKE, toast } from '../../../ui/components';
import { ModeBadge } from '../../components/ModeBadge';
import { sideOf, wordDiff, type DiffPart } from '../../lib/diff';

const HEADINGS = {
  dictate: { raw: 'What you said', output: 'What Rivertide wrote' },
  ask: { raw: 'What you asked', output: 'The answer' },
  command: { raw: 'What you asked Leafy', output: 'Leafy’s reply' },
} as const;

function DiffText({ parts }: { readonly parts: readonly DiffPart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'removed') return <del key={i} className="diff-removed">{part.text}</del>;
        if (part.kind === 'added') return <ins key={i} className="diff-added">{part.text}</ins>;
        return <span key={i}>{part.text}</span>;
      })}
    </>
  );
}

function Compare({ item }: { readonly item: HistoryItem }) {
  const headings = HEADINGS[item.mode];
  const diff = useMemo(() => (item.mode === 'dictate' && item.output ? wordDiff(item.raw, item.output) : null), [item]);
  return (
    <section aria-label="Comparison">
      <div className="history-compare">
        <div>
          <h3 className="history-heading">{headings.raw}</h3>
          <p className="history-text">{diff ? <DiffText parts={sideOf(diff, 'before')} /> : item.raw || <span className="muted">Nothing was heard.</span>}</p>
        </div>
        <div>
          <h3 className="history-heading">{headings.output}</h3>
          <p className="history-text">{diff ? <DiffText parts={sideOf(diff, 'after')} /> : item.output || <span className="muted">No output.</span>}</p>
        </div>
      </div>
      {diff ? <p className="history-legend" style={{ marginTop: 8 }}>Crossed-out words were tidied away. Underlined words were added.</p> : null}
    </section>
  );
}

function Facts({ item }: { readonly item: HistoryItem }) {
  const rows: [string, string][] = [
    ['Words', formatCount(item.words)],
    ['Speaking time', formatDuration(item.durationMs)],
    ['Speech to text', formatDuration(item.timings.sttMs)],
    ['Writing', formatDuration(item.timings.llmMs)],
    ['Total', formatDuration(item.timings.totalMs)],
  ];
  return (
    <section aria-labelledby="history-details">
      <h3 id="history-details" className="history-heading">Details</h3>
      <dl className="history-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {item.providers.stt || item.providers.llm ? (
        <p className="history-legend" style={{ marginTop: 8 }}>
          {[item.providers.stt && `Heard by ${item.providers.stt}`, item.providers.llm && `written by ${item.providers.llm}`].filter(Boolean).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

function ActionsTaken({ item }: { readonly item: HistoryItem }) {
  if (item.actions.length === 0) return null;
  return (
    <section aria-labelledby="history-actions">
      <h3 id="history-actions" className="history-heading">What Leafy did</h3>
      <ul className="history-actions-taken">
        {item.actions.map((action, i) => (
          <li key={`${action.tool}-${i}`}>
            {action.ok ? (
              <CircleCheck size={18} strokeWidth={ICON_STROKE} style={{ color: 'var(--accent)' }} aria-label="Done" />
            ) : (
              <CircleX size={18} strokeWidth={ICON_STROKE} style={{ color: 'var(--danger)' }} aria-label="Didn’t work" />
            )}
            {action.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface HistoryDetailProps {
  readonly item: HistoryItem;
  readonly calm: boolean;
  readonly onDelete: (item: HistoryItem) => void;
}

export function HistoryDetail({ item, calm, onDelete }: HistoryDetailProps) {
  const [pasting, setPasting] = useState(false);
  const text = item.output || item.raw;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied.');
    } catch {
      toast.error('Couldn’t copy. Select the text and press ⌘C instead.');
    }
  };

  const repaste = async () => {
    setPasting(true);
    try {
      const { pasted } = await invoke('history:repaste', { id: item.id });
      if (pasted) toast.success('Pasted where your cursor was.');
      else toast.info('It’s on your clipboard. Click where you want it and press ⌘V.');
    } catch (error) {
      toast.error(`Couldn’t paste it. ${errorMessage(error)}`);
    } finally {
      setPasting(false);
    }
  };

  return (
    <article className="history-detail" aria-labelledby="history-detail-title">
      <div>
        <h2 id="history-detail-title" className="visually-hidden">Details for {formatDateTime(item.createdAt)}</h2>
        <div className="history-detail__head">
          <ModeBadge mode={item.mode} />
          <span>{formatDateTime(item.createdAt)}</span>
          {item.app ? <span>in {item.app.name}</span> : null}
        </div>
      </div>
      {item.error ? <p className="history-error" role="note">{item.error}</p> : null}
      <Compare item={item} />
      <div className="history-detail__actions">
        <Button icon={Copy} onClick={() => void copy()} disabled={!text}>Copy</Button>
        <Button icon={ClipboardPaste} loading={pasting} onClick={() => void repaste()} disabled={!text}>Paste again</Button>
        <Button icon={Trash2} variant="danger" onClick={() => onDelete(item)}>Delete</Button>
      </div>
      {calm ? null : (
        <>
          <ActionsTaken item={item} />
          <Facts item={item} />
        </>
      )}
    </article>
  );
}
