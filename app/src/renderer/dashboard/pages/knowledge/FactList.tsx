import { useId } from 'react';
import { Pencil, Pin, Trash2 } from 'lucide-react';
import type { Fact } from '@shared/types';
import { Badge, IconButton } from '../../../ui/components';
import { formatRelative, pluralize } from '../../../lib/format';
import { SOURCE_NAMES, type FactGroup } from './knowledge-model';

export interface FactActions {
  readonly onEdit: (fact: Fact) => void;
  readonly onDelete: (fact: Fact) => void;
  readonly onTogglePin: (fact: Fact) => void;
}

interface FactRowProps extends FactActions {
  readonly fact: Fact;
  readonly now: Date;
}

function FactRow({ fact, now, onEdit, onDelete, onTogglePin }: FactRowProps) {
  return (
    <li className="knowledge-fact">
      <div className="knowledge-fact__text">
        <p className="knowledge-fact__label">
          <span>{fact.label}</span>
          {fact.pinned ? <Badge tone="accent" icon={Pin}>Pinned</Badge> : null}
        </p>
        <p className="knowledge-fact__value">{fact.value}</p>
        <p className="knowledge-fact__meta">
          {SOURCE_NAMES[fact.source]} · Updated <time dateTime={fact.updatedAt}>{formatRelative(fact.updatedAt, now)}</time>
        </p>
      </div>
      <div className="knowledge-fact__actions">
        <IconButton label={`Pin ${fact.label}`} icon={Pin} aria-pressed={fact.pinned} onClick={() => onTogglePin(fact)} />
        <IconButton label={`Edit ${fact.label}`} icon={Pencil} onClick={() => onEdit(fact)} />
        <IconButton label={`Delete ${fact.label}`} icon={Trash2} variant="danger" onClick={() => onDelete(fact)} />
      </div>
    </li>
  );
}

interface FactGroupSectionProps extends FactActions {
  readonly group: FactGroup;
  readonly now: Date;
}

/** One category: an h2 with its count, then the facts as a list. */
export function FactGroupSection({ group, now, ...actions }: FactGroupSectionProps) {
  const headingId = useId();
  return (
    <section className="knowledge-group" aria-labelledby={headingId}>
      <h2 id={headingId} className="knowledge-group__title">
        {group.name}
        <span className="knowledge-group__count tabular" aria-hidden>{group.facts.length}</span>
        <span className="visually-hidden">, {pluralize(group.facts.length, 'fact')}</span>
      </h2>
      <ul className="knowledge-group__list">
        {group.facts.map((fact) => (
          <FactRow key={fact.id} fact={fact} now={now} {...actions} />
        ))}
      </ul>
    </section>
  );
}
