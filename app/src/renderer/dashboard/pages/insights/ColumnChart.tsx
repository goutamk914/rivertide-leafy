/** Single-series day columns: thin bars from one baseline, the highest one labelled, per-day tooltip. */
import { useMemo } from 'react';
import { useChartCursor, useElementWidth } from './chart-hooks';
import { DEFAULT_CHART_WIDTH, PlotShell, XAxis, YAxis, axisWidth, maxDateTicks, type ActiveDay, type PlotBox } from './ChartParts';
import {
  DEFAULT_TICK_COUNT, bandScale, clamp, columnPath, labelAnchor, linearScale, niceDomain, niceTicks, tickIndices,
  type BandScale, type LinearScale,
} from './scales';
import { describeSeries, maxDefined, type DayValue } from './series';

export interface ColumnChartProps {
  readonly title: string;
  readonly series: readonly DayValue[];
  readonly format: (value: number) => string;
  readonly valueLabel: (value: number) => string;
  /** Total SVG height, x-axis band included. */
  readonly height: number;
  readonly tickCount?: number;
  readonly fallbackWidth?: number;
}

const MARGIN_TOP = 22;
const MARGIN_RIGHT = 8;
const MARGIN_BOTTOM = 30;
const MAX_BAR = 24;
const MIN_BAR = 1;
/** Surface gap kept between neighbouring columns. */
const BAR_GAP = 2;
const CAP_LABEL_GAP = 6;
const CAP_LABEL_HALF = 20;

interface ColumnLayout {
  readonly box: PlotBox;
  readonly x: BandScale;
  readonly y: LinearScale;
  readonly ticks: readonly number[];
  readonly xTicks: readonly number[];
  readonly barWidth: number;
}

function columnLayout(series: readonly DayValue[], height: number, format: (value: number) => string, tickCount: number, width: number): ColumnLayout {
  const top = maxDefined(series)?.value ?? 0;
  const domain = niceDomain(0, Math.max(top, 1), tickCount);
  const ticks = niceTicks(domain[0], domain[1], tickCount);
  const left = axisWidth(ticks.map(format));
  const box: PlotBox = { left, right: width - MARGIN_RIGHT, top: MARGIN_TOP, bottom: height - MARGIN_BOTTOM };
  const x = bandScale(series.length, [box.left, box.right]);
  return {
    box, x, ticks,
    y: linearScale(domain, [box.bottom, box.top]),
    xTicks: tickIndices(series.length, maxDateTicks(box.right - box.left)),
    barWidth: clamp(Math.min(MAX_BAR, x.bandwidth, x.step - BAR_GAP), MIN_BAR, MAX_BAR),
  };
}

export function ColumnChart({ title, series, format, valueLabel, height, tickCount = DEFAULT_TICK_COUNT, fallbackWidth = DEFAULT_CHART_WIDTH }: ColumnChartProps) {
  const { ref, width } = useElementWidth(fallbackWidth);
  const layout = useMemo(() => columnLayout(series, height, format, tickCount, width), [series, height, format, tickCount, width]);
  const cursor = useChartCursor(series.length, layout.x.indexAt);
  const desc = useMemo(() => describeSeries(series, format), [series, format]);

  const { box, x, y, barWidth } = layout;
  const highest = maxDefined(series);
  const activeDay = cursor.active !== null ? series[cursor.active] : undefined;
  const active: ActiveDay | null = activeDay && cursor.active !== null ? { x: x.center(cursor.active), date: activeDay.date, value: activeDay.value } : null;

  return (
    <PlotShell title={title} desc={desc} width={width} height={height} box={box} measureRef={ref} cursor={cursor} active={active} valueLabel={valueLabel}>
      <YAxis ticks={layout.ticks} y={y} box={box} format={format} />
      <XAxis indices={layout.xTicks} xAt={x.center} series={series} box={box} />
      <g className={active ? 'ins-columns ins-columns--focus' : 'ins-columns'} aria-hidden="true">
        {series.map((day, index) => {
          if (day.value === null || day.value <= 0) return null;
          const top = y.map(day.value);
          return (
            <path
              key={day.date}
              className={index === cursor.active ? 'ins-column ins-column--active' : 'ins-column'}
              d={columnPath(x.center(index) - barWidth / 2, top, barWidth, box.bottom - top)}
            />
          );
        })}
      </g>
      {highest && highest.value !== null && highest.value > 0 ? (
        <text
          className="ins-direct-label"
          x={x.center(series.indexOf(highest))}
          y={y.map(highest.value) - CAP_LABEL_GAP}
          textAnchor={labelAnchor(x.center(series.indexOf(highest)), box.left, box.right, CAP_LABEL_HALF)}
          aria-hidden="true"
        >
          {format(highest.value)}
        </text>
      ) : null}
    </PlotShell>
  );
}
