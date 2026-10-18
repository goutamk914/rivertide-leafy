/** Speech dynamics: the latest reading, the fog index, pace / pauses / fillers and plain observations. */
import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import type { DataDomain, DynamicsSummary } from '@shared/types';
import { invoke } from '../../../lib/ipc';
import { Card, EmptyState, ICON_STROKE, SectionHeader, cx } from '../../../ui/components';
import { useIpcQuery } from '../../hooks/useIpc';
import { PageError } from '../../shell/Page';
import { ChartFigure, ChartMessage, SeriesTable, TableToggle } from './ChartParts';
import { LineChart } from './LineChart';
import { DynamicsSkeleton } from './Skeletons';
import { FOG_DOMAIN, FOG_STEADY_MAX, dynamicsSeries, fogSentence, formatValue, hasData, isReadingToday, type DayValue, type RangeDays } from './series';
import type { Pair } from './scales';

const DYNAMICS_DOMAINS: readonly DataDomain[] = ['dynamics'];
const HEADING_ID = 'insights-dynamics-heading';
export const FOG_CHART_HEIGHT = 232;
export const SMALL_CHART_HEIGHT = 168;
const SMALL_TICK_COUNT = 3;
const SMALL_FALLBACK_WIDTH = 320;
const FOG_TICKS = [0, 25, 50, 75, 100] as const;
const FOG_BAND: Pair = [0, FOG_STEADY_MAX];

export const DISCLAIMER = 'This is not a diagnosis. It compares you only with your own recent days.';
export const NOT_READY = 'Insights appear after a few days of talking with Rivertide.';
export const DYNAMICS_ERROR = 'Your speech insights didn’t load. Try again, or restart Rivertide if this keeps happening.';
const NO_SESSIONS = 'No sessions in this range yet.';

const whole = (value: number) => formatValue(value, false);
const oneDecimal = (value: number) => formatValue(value, true);

interface MetricSpec {
  readonly key: 'pace' | 'pauses' | 'fillers';
  readonly title: string;
  readonly explanation: string;
  readonly header: string;
  readonly format: (value: number) => string;
  readonly valueLabel: (value: number) => string;
  readonly zeroBased: boolean;
}

const METRICS: readonly MetricSpec[] = [
  {
    key: 'pace', title: 'Pace', header: 'Words per minute', format: whole, zeroBased: false,
    explanation: 'Words per minute while you were speaking, averaged for each day.',
    valueLabel: (v) => `${whole(v)} words per minute`,
  },
  {
    key: 'pauses', title: 'Pauses', header: 'Pauses per session', format: oneDecimal, zeroBased: true,
    explanation: 'How many times you paused in a session, on average, each day.',
    valueLabel: (v) => `${oneDecimal(v)} pauses per session`,
  },
  {
    key: 'fillers', title: 'Filler words', header: 'Fillers per 100 words', format: oneDecimal, zeroBased: true,
    explanation: 'Words like “um” and “uh” for every 100 words you said.',
    valueLabel: (v) => `${oneDecimal(v)} per 100 words`,
  },
];

const fogLabel = (value: number) => `Fog index ${whole(value)}`;

interface FigureProps {
  readonly series: readonly DayValue[];
  readonly showTable: boolean;
}

function FogBody({ series, showTable }: FigureProps) {
  if (showTable) return <SeriesTable caption="Fog index per day" header="Fog index" series={series} format={whole} />;
  if (!hasData(series)) return <ChartMessage height={FOG_CHART_HEIGHT}>{NO_SESSIONS}</ChartMessage>;
  return (
    <LineChart
      title="Fog index"
      series={series}
      format={whole}
      valueLabel={fogLabel}
      height={FOG_CHART_HEIGHT}
      domain={FOG_DOMAIN}
      ticks={FOG_TICKS}
      band={FOG_BAND}
      descNote={`The shaded band from 0 to ${FOG_STEADY_MAX} is your usual range.`}
    />
  );
}

function FogFigure({ series, showTable }: FigureProps) {
  const legend = showTable || !hasData(series) ? null : (
    <p className="ins-legend">
      <span className="ins-legend__swatch" aria-hidden="true" />
      Your usual range
    </p>
  );
  return (
    <ChartFigure title="Fog index" explanation="A score from 0 to 100 comparing how you spoke with your own usual. Lower is clearer." footer={legend}>
      <FogBody series={series} showTable={showTable} />
    </ChartFigure>
  );
}

function MetricBody({ spec, series, showTable }: FigureProps & { readonly spec: MetricSpec }) {
  if (showTable) return <SeriesTable caption={`${spec.title} per day`} header={spec.header} series={series} format={spec.format} />;
  if (!hasData(series)) return <ChartMessage height={SMALL_CHART_HEIGHT}>{NO_SESSIONS}</ChartMessage>;
  return (
    <LineChart
      title={spec.title}
      series={series}
      format={spec.format}
      valueLabel={spec.valueLabel}
      height={SMALL_CHART_HEIGHT}
      tickCount={SMALL_TICK_COUNT}
      zeroBased={spec.zeroBased}
      fallbackWidth={SMALL_FALLBACK_WIDTH}
    />
  );
}

function Observations({ items }: { readonly items: readonly string[] }) {
  return (
    <Card className="ins-notes">
      <h3 className="ins-figure__title">What Rivertide noticed</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, i) => (
            <li key={`${i}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="ins-muted">Nothing stands out yet. Patterns show up here as you keep talking.</p>
      )}
    </Card>
  );
}

function Disclaimer() {
  return (
    <p className="ins-disclaimer">
      <Info size={18} strokeWidth={ICON_STROKE} aria-hidden />
      <span>{DISCLAIMER}</span>
    </p>
  );
}

function DynamicsBody({ data, calm, showTable }: { readonly data: DynamicsSummary; readonly calm: boolean; readonly showTable: boolean }) {
  const series = useMemo(() => dynamicsSeries(data), [data]);
  return (
    <>
      {data.latest ? (
        <Card className="ins-reading">
          <p className="ins-reading__text">{fogSentence(data.latest.label, isReadingToday(data.daily))}</p>
        </Card>
      ) : null}
      <FogFigure series={series.fog} showTable={showTable} />
      {calm ? null : (
        <>
          <div className="ins-multiples">
            {METRICS.map((spec) => (
              <ChartFigure key={spec.key} title={spec.title} explanation={spec.explanation}>
                <MetricBody spec={spec} series={series[spec.key]} showTable={showTable} />
              </ChartFigure>
            ))}
          </div>
          <Observations items={data.insights} />
        </>
      )}
      <Disclaimer />
    </>
  );
}

export function DynamicsSection({ days, calm }: { readonly days: RangeDays; readonly calm: boolean }) {
  const query = useIpcQuery(() => invoke('insights:dynamics', { days }), [days], DYNAMICS_DOMAINS);
  const [showTable, setShowTable] = useState(false);
  const data = query.data;
  const ready = data?.baselineReady === true;
  const toggle = ready ? <TableToggle showTable={showTable} onToggle={() => setShowTable((v) => !v)} /> : null;

  return (
    <section className="ins-section" aria-labelledby={HEADING_ID}>
      <SectionHeader id={HEADING_ID} title="Speech dynamics" description="How your speaking compares with your own usual." actions={toggle} />
      {query.error ? <PageError message={DYNAMICS_ERROR} onRetry={query.reload} /> : null}
      {data ? (
        <div className={cx('ins-stack', query.refreshing && 'ins-refreshing')} aria-busy={query.refreshing}>
          {ready ? <DynamicsBody data={data} calm={calm} showTable={showTable} /> : <EmptyState pose="sprouting" title={NOT_READY} />}
        </div>
      ) : query.error ? null : (
        <DynamicsSkeleton calm={calm} chartHeight={FOG_CHART_HEIGHT} smallHeight={SMALL_CHART_HEIGHT} />
      )}
    </section>
  );
}
