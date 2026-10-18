import { useEffect } from 'react';
import type { SearchResult } from '@shared/types';
import { Icon } from '../lib/hooks/Icon';
import { keepInputFocus } from './PaletteHeader';
import { resolveResultIcon } from './resultIcon';
import { rowHint, type GroupedResults } from './sections';

export const optionId = (index: number) => `pl-opt-${index}`;
const QUICK_PICKS = 9;

function ResultIcon({ result }: { readonly result: SearchResult }) {
  const icon = resolveResultIcon(result.icon, result.kind);
  return (
    <span className="pl-row__icon" data-kind={result.kind} aria-hidden="true">
      {icon.type === 'image' ? <img src={icon.src} alt="" width={28} height={28} draggable={false} /> : <Icon name={icon.name} size={18} />}
    </span>
  );
}

interface RowProps {
  readonly result: SearchResult;
  readonly index: number;
  readonly active: boolean;
  readonly quickKeyLabel: string | null;
  readonly onHover: (index: number) => void;
  readonly onExecute: (result: SearchResult, alt: boolean) => void;
}

function ResultRow({ result, index, active, quickKeyLabel, onHover, onExecute }: RowProps) {
  const hint = rowHint(result);
  return (
    <div
      id={optionId(index)}
      role="option"
      aria-selected={active}
      className="pl-row"
      data-active={active}
      onMouseDown={keepInputFocus}
      onMouseMove={() => (active ? undefined : onHover(index))}
      onClick={(event) => onExecute(result, event.altKey)}
    >
      <ResultIcon result={result} />
      <span className="pl-row__text">
        <span className="pl-row__title">{result.title}</span>
        {result.subtitle ? <span className="pl-row__subtitle">{result.subtitle}</span> : null}
      </span>
      <span className="pl-row__hint" aria-hidden="true">
        {active && hint.alt ? (
          <span className="pl-hint">
            <kbd className="pl-kbd">⌥↵</kbd>
            {hint.alt}
          </span>
        ) : null}
        {active ? (
          <span className="pl-hint">
            <kbd className="pl-kbd">↵</kbd>
            {hint.primary}
          </span>
        ) : null}
        {!active && quickKeyLabel ? <kbd className="pl-kbd pl-kbd--quiet">{quickKeyLabel}</kbd> : null}
      </span>
    </div>
  );
}

export interface ResultsListProps {
  readonly grouped: GroupedResults;
  readonly activeIndex: number;
  /** Show ⌘1–9 badges (while the modifier is held). */
  readonly showQuickKeys: boolean;
  readonly quickModifier: string;
  readonly onHover: (index: number) => void;
  readonly onExecute: (result: SearchResult, alt: boolean) => void;
}

/** Grouped, keyboard-driven results (a listbox controlled by the input via aria-activedescendant). */
export function ResultsList({ grouped, activeIndex, showQuickKeys, quickModifier, onHover, onExecute }: ResultsListProps) {
  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div id="pl-results" role="listbox" aria-label="Results" className="pl-results">
      {grouped.sections.map((section) => (
        <div key={section.id} role="group" aria-labelledby={`pl-sec-${section.id}`} className="pl-section">
          <div id={`pl-sec-${section.id}`} className="pl-section__title">
            {section.title}
          </div>
          {section.items.map((result, offset) => {
            const index = section.start + offset;
            return (
              <ResultRow
                key={result.id}
                result={result}
                index={index}
                active={index === activeIndex}
                quickKeyLabel={showQuickKeys && index < QUICK_PICKS ? `${quickModifier}${index + 1}` : null}
                onHover={onHover}
                onExecute={onExecute}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
