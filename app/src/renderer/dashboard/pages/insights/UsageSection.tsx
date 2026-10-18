/** Usage: the KPI row, words per day, and the apps Rivertide was used in most. */
import { useMemo, useState } from 'react';
import type { DataDomain, UsageSummary } from '@shared/types';
import { invoke } from '../../../lib/ipc';
import { formatCompact, formatCount, pluralize } from '../../../lib/format';
import { SectionHeader, cx } from '../../../ui/components';
import { useIpcQuery } from '../../hooks/useIpc';
import { PageError } from '../../shell/Page';
import { ChartFigure, ChartMessage, DataTable, TableToggle } from './ChartParts';
import { ColumnChart } from './ColumnChart';
import { UsageSkeleton } from './Skeletons';
import { BarList, KpiRow } from './UsageParts';
import { formatDayLabel, hasData, topApps, wordsSeries, type RangeDays } from './series';

const USAGE_DOMAINS: readonly DataDomain[] = ['history'];
const HEADING_ID = 'insights-usage-heading';
export const WORDS_CHART_HEIGHT = 216;
export const USAGE_ERROR = 'Your usage numbers didn’t load. Try again, or restart Rivertide if this keeps happening.';

const formatWords = (value: number) => formatCompact(value);
const wordsLabel = (value: number) => pluralize(value, 'word');

interface FigureProps {
  readonly usage: UsageSummary;
  readonly showTable: boolean;
}

function WordsBody({ usage, showTable }: FigureProps) {
  const series = useMemo(() => wordsSeries(usage.daily), [usage.daily]);
  if (showTable) {
    const rows = usage.daily.map((d) => ({ key: d.date, cells: [formatDayLabel(d.date), formatCount(d.words), formatCount(d.sessions)] }));
    return <DataTable caption="Words and sessions per day" headers={['Day', 'Words', 'Sessions']} rows={rows} />;
  }
  if (!hasData(series, true)) return <ChartMessage height={WORDS_CHART_HEIGHT}>No words in this range yet.</ChartMessage>;
  return <ColumnChart title="Words per day" series={series} format={formatWords} valueLabel={wordsLabel} height={WORDS_CHART_HEIGHT} />;
}

function AppsBody({ usage, showTable }: FigureProps) {
  const apps = topApps(usage.topApps);
  if (apps.length === 0) return <p className="ins-muted">No apps in this range yet.</p>;
  if (!showTable) return <BarList items={apps} label="Top apps by sessions" unit="session" />;
  const rows = apps.map((app) => ({ key: app.label, cells: [app.label, formatCount(app.value)] }));
  return <DataTable caption="Top apps by sessions" headers={['App', 'Sessions']} rows={rows} />;
}

export function UsageSection({ days, calm }: { readonly days: RangeDays; readonly calm: boolean }) {
  const query = useIpcQuery(() => invoke('insights:usage', { days }), [days], USAGE_DOMAINS);
  const [showTable, setShowTable] = useState(false);
  const usage = query.data;
  const toggle = !calm && usage ? <TableToggle showTable={showTable} onToggle={() => setShowTable((v) => !v)} /> : null;

  return (
    <section className="ins-section" aria-labelledby={HEADING_ID}>
      <SectionHeader id={HEADING_ID} title="Usage" description="How much you talked with Rivertide." actions={toggle} />
      {query.error ? <PageError message={USAGE_ERROR} onRetry={query.reload} /> : null}
      {usage ? (
        <div className={cx('ins-stack', query.refreshing && 'ins-refreshing')} aria-busy={query.refreshing}>
          <KpiRow usage={usage} days={days} />
          {calm ? null : (
            <div className="ins-usage-grid">
              <ChartFigure title="Words per day" explanation="How many words you spoke to Rivertide each day.">
                <WordsBody usage={usage} showTable={showTable} />
              </ChartFigure>
              <ChartFigure title="Top apps" explanation="Where you used Rivertide most.">
                <AppsBody usage={usage} showTable={showTable} />
              </ChartFigure>
            </div>
          )}
        </div>
      ) : query.error ? null : (
        <UsageSkeleton calm={calm} chartHeight={WORDS_CHART_HEIGHT} />
      )}
    </section>
  );
}
