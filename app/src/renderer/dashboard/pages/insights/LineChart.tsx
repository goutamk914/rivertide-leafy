/** Single-series day line: 2px line that breaks on missing days, optional shaded band, crosshair tooltip. */
import { useMemo } from 'react';
import { useChartCursor, useElementWidth } from './chart-hooks';
import { DEFAULT_CHART_WIDTH, Marker, PlotShell, XAxis, YAxis, axisWidth, crisp, maxDateTicks, type ActiveDay, type PlotBox } from './ChartParts';
import {
  DEFAULT_TICK_COUNT, isolatedPoints, linePath, linearScale, niceDomain, niceTicks, pointScale, tickIndices,
  type LinearScale, type Pair, type Point, type PointScale,
} from './scales';
import { describeSeries, lastDefined, valueExtent, type DayValue } from './series';

export interface LineChartProps {
  readonly title: string;
  readonly series: readonly DayValue[];
  /** Short number for axis ticks and the end label. */
  readonly format: (value: number) => string;
  /** Full phrase for the tooltip and screen readers, e.g. "118 words per minute". */
  readonly valueLabel: (value: number) => string;
  /** Total SVG height, x-axis band included. */
  readonly height: number;
  /** Fixed y domain (otherwise fitted to the data). */
  readonly domain?: Pair;
  readonly ticks?: readonly number[];
  readonly tickCount?: number;
  /** Start the y-axis at zero (counts and rates). */
  readonly zeroBased?: boolean;
  /** Shaded horizontal band, e.g. the steady zone. */
  readonly band?: Pair;
  /** Extra sentence for the chart description (e.g. what the band means). */
  readonly descNote?: string;
  readonly fallbackWidth?: number;
}

const MARGIN_TOP = 12;
const MARGIN_RIGHT = 44;
const MARGIN_BOTTOM = 30;
const END_LABEL_GAP = 10;

interface LineLayout {
  readonly box: PlotBox;
  readonly x: PointScale;
  readonly y: LinearScale;
  readonly ticks: readonly number[];
  readonly xTicks: readonly number[];
  readonly points: readonly (Point | null)[];
  readonly path: string;
  readonly isolated: readonly Point[];
}

function fitDomain(series: readonly DayValue[], zeroBased: boolean, tickCount: number): Pair {
  const [min, max] = valueExtent(series) ?? [0, 1];
  return niceDomain(zeroBased ? Math.min(0, min) : min, max, tickCount);
}

type LayoutInput = Pick<LineChartProps, 'series' | 'height' | 'format' | 'domain' | 'ticks' | 'tickCount' | 'zeroBased'>;

function lineLayout(input: LayoutInput, width: number): LineLayout {
  const { series, height, format, domain, zeroBased = false, tickCount = DEFAULT_TICK_COUNT } = input;
  const yDomain = domain ?? fitDomain(series, zeroBased, tickCount);
  const ticks = input.ticks ?? niceTicks(yDomain[0], yDomain[1], tickCount);
  const left = axisWidth(ticks.map(format));
  const box: PlotBox = { left, right: width - MARGIN_RIGHT, top: MARGIN_TOP, bottom: height - MARGIN_BOTTOM };
  const x = pointScale(series.length, [box.left, box.right]);
  const y = linearScale(yDomain, [box.bottom, box.top]);
  const points = series.map((day, i) => (day.value === null ? null : { x: x.position(i), y: y.map(day.value) }));
  return {
    box, x, y, ticks, points,
    xTicks: tickIndices(series.length, maxDateTicks(box.right - box.left)),
    path: linePath(points),
    isolated: isolatedPoints(points),
  };
}

export function LineChart({
  title, series, format, valueLabel, height, band, descNote, domain, ticks, tickCount, zeroBased, fallbackWidth = DEFAULT_CHART_WIDTH,
}: LineChartProps) {
  const { ref, width } = useElementWidth(fallbackWidth);
  const layout = useMemo(
    () => lineLayout({ series, height, format, domain, ticks, tickCount, zeroBased }, width),
    [series, height, format, domain, ticks, tickCount, zeroBased, width],
  );
  const cursor = useChartCursor(series.length, layout.x.indexAt);
  const desc = useMemo(() => [describeSeries(series, format), descNote].filter(Boolean).join(' '), [series, format, descNote]);

  const { box, x, y, points } = layout;
  const latest = lastDefined(series);
  const latestIndex = latest ? series.indexOf(latest) : -1;
  const latestPoint = latestIndex >= 0 ? points[latestIndex] : null;
  const activePoint = cursor.active !== null ? points[cursor.active] ?? null : null;
  const activeDay = cursor.active !== null ? series[cursor.active] : undefined;
  const active: ActiveDay | null = activeDay && cursor.active !== null ? { x: x.position(cursor.active), date: activeDay.date, value: activeDay.value } : null;

  return (
    <PlotShell title={title} desc={desc} width={width} height={height} box={box} measureRef={ref} cursor={cursor} active={active} valueLabel={valueLabel}>
      {band ? (
        <rect className="ins-band" x={box.left} width={Math.max(0, box.right - box.left)} y={y.map(band[1])} height={Math.max(0, y.map(band[0]) - y.map(band[1]))} />
      ) : null}
      <YAxis ticks={layout.ticks} y={y} box={box} format={format} />
      <XAxis indices={layout.xTicks} xAt={x.position} series={series} box={box} />
      <path className="ins-line" d={layout.path} />
      {layout.isolated.map((p) => (
        <Marker key={`${p.x}-${p.y}`} x={p.x} y={p.y} />
      ))}
      {active ? <line className="ins-crosshair" x1={crisp(active.x)} x2={crisp(active.x)} y1={box.top} y2={box.bottom} /> : null}
      {latestPoint && latest?.value != null ? (
        <g aria-hidden="true">
          <Marker x={latestPoint.x} y={latestPoint.y} />
          <text className="ins-direct-label" x={latestPoint.x + END_LABEL_GAP} y={latestPoint.y} dy="0.32em">
            {format(latest.value)}
          </text>
        </g>
      ) : null}
      {activePoint ? <Marker x={activePoint.x} y={activePoint.y} /> : null}
    </PlotShell>
  );
}
