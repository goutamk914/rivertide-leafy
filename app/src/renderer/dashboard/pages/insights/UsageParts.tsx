/** Usage figures: the KPI row of stat tiles and the top-apps bar list. */
import type { ReactNode } from 'react';
import type { UsageSummary } from '@shared/types';
import { Card } from '../../../ui/components';
import { formatCompact, formatCount, pluralize } from '../../../lib/format';
import { modeSplit, type LabelledCount, type RangeDays } from './series';

const PERCENT = 100;

function StatTile({ label, value, caption }: { readonly label: string; readonly value: ReactNode; readonly caption?: string }) {
  return (
    <Card padding="tight" className="ins-tile">
      <dt className="ins-tile__label">{label}</dt>
      <dd className="ins-tile__value">{value}</dd>
      {caption ? <dd className="ins-tile__caption">{caption}</dd> : null}
    </Card>
  );
}

/** Words, sessions, streak and the dictation / ask / command split for the chosen range. */
export function KpiRow({ usage, days }: { readonly usage: UsageSummary; readonly days: RangeDays }) {
  const range = `in the last ${days} days`;
  return (
    <dl className="ins-kpis">
      <StatTile label="Words" value={formatCompact(usage.totals.words)} caption={range} />
      <StatTile label="Sessions" value={formatCount(usage.totals.sessions)} caption={range} />
      <StatTile label="Streak" value={pluralize(usage.streakDays, 'day')} caption="in a row" />
      <Card padding="tight" className="ins-tile">
        <dt className="ins-tile__label">By mode</dt>
        <dd className="ins-tile__split">
          <ul>
            {modeSplit(usage.totals).map((mode) => (
              <li key={mode.label}>
                <span>{mode.label}</span>
                <span className="tabular">{formatCount(mode.value)}</span>
              </li>
            ))}
          </ul>
        </dd>
      </Card>
    </dl>
  );
}

/** Horizontal bars with their values written out (the values are the point; bars just compare). `unit` is singular. */
export function BarList({ items, label, unit }: { readonly items: readonly LabelledCount[]; readonly label: string; readonly unit: string }) {
  const max = items.reduce((m, item) => Math.max(m, item.value), 0) || 1;
  return (
    <ul className="ins-bars" aria-label={label}>
      {items.map((item) => (
        <li key={item.label} className="ins-bars__row">
          <span className="ins-bars__name">{item.label}</span>
          <span className="ins-bars__value tabular">
            <span aria-hidden="true">{formatCount(item.value)}</span>
            <span className="visually-hidden">{pluralize(item.value, unit)}</span>
          </span>
          <span className="ins-bars__track" aria-hidden="true">
            <span className="ins-bars__bar" style={{ width: `${(item.value / max) * PERCENT}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
