/** Shared chart pieces: the figure frame, axes, the plot shell with tooltip, markers and table twins. */
import { useId, type ReactNode } from 'react';
import { ChartColumn, Table2 } from 'lucide-react';
import { Button, Card, cx } from '../../../ui/components';
import type { ChartCursor } from './chart-hooks';
import { labelAnchor, type LinearScale } from './scales';
import { formatDayLabel, formatTickDate, type DayValue } from './series';

/** Pixel edges of the plotting area inside the SVG. */
export interface PlotBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const DEFAULT_CHART_WIDTH = 640;
const TICK_CHAR_PX = 7.5;
const AXIS_GAP = 10;
const MIN_AXIS_WIDTH = 28;
const X_LABEL_OFFSET = 20;
const X_LABEL_HALF = 22;
const X_LABEL_SPACING = 76;
const TOOLTIP_OFFSET = 12;
const MARKER_RING = 6;
const MARKER_DOT = 4;

/** Room the y-axis labels need, from their longest label. */
export function axisWidth(labels: readonly string[]): number {
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  return Math.max(MIN_AXIS_WIDTH, Math.ceil(longest * TICK_CHAR_PX) + AXIS_GAP);
}

/** How many date labels fit under a plot this wide. */
export function maxDateTicks(plotWidth: number): number {
  return Math.max(2, Math.floor(plotWidth / X_LABEL_SPACING));
}

/** Snaps a horizontal hairline to the pixel grid so it renders 1px crisp. */
export const crisp = (value: number) => Math.round(value) + 0.5;

export interface ChartFigureProps {
  readonly title: string;
  readonly explanation?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

/** A card holding one chart: an h3 title, a one-line explanation, the chart (or its table). */
export function ChartFigure({ title, explanation, children, footer, className }: ChartFigureProps) {
  const id = useId();
  return (
    <Card as="figure" className={cx('ins-figure', className)} aria-labelledby={`${id}-title`}>
      <figcaption className="ins-figure__head">
        <h3 id={`${id}-title`} className="ins-figure__title">
          {title}
        </h3>
        {explanation ? <p className="ins-figure__text">{explanation}</p> : null}
      </figcaption>
      {children}
      {footer}
    </Card>
  );
}

export function YAxis({ ticks, y, box, format }: { readonly ticks: readonly number[]; readonly y: LinearScale; readonly box: PlotBox; readonly format: (value: number) => string }) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const at = crisp(y.map(tick));
        return (
          <g key={tick}>
            <line className="ins-grid" x1={box.left} x2={box.right} y1={at} y2={at} />
            <text className="ins-tick" x={box.left - AXIS_GAP} y={at} dy="0.32em" textAnchor="end">
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function XAxis({ indices, xAt, series, box }: { readonly indices: readonly number[]; readonly xAt: (index: number) => number; readonly series: readonly DayValue[]; readonly box: PlotBox }) {
  return (
    <g aria-hidden="true">
      {indices.map((index) => {
        const day = series[index];
        if (!day) return null;
        const x = xAt(index);
        return (
          <text key={day.date} className="ins-tick" x={x} y={box.bottom + X_LABEL_OFFSET} textAnchor={labelAnchor(x, box.left, box.right, X_LABEL_HALF)}>
            {formatTickDate(day.date)}
          </text>
        );
      })}
    </g>
  );
}

/** An 8px series dot inside a 2px surface ring. */
export function Marker({ x, y }: { readonly x: number; readonly y: number }) {
  return (
    <g className="ins-marker" aria-hidden="true">
      <circle className="ins-marker__ring" cx={x} cy={y} r={MARKER_RING} />
      <circle className="ins-marker__dot" cx={x} cy={y} r={MARKER_DOT} />
    </g>
  );
}

export interface ActiveDay {
  readonly x: number;
  readonly date: string;
  readonly value: number | null;
}

export interface PlotShellProps {
  readonly title: string;
  readonly desc: string;
  readonly width: number;
  readonly height: number;
  readonly box: PlotBox;
  readonly measureRef: (node: HTMLElement | null) => void;
  readonly cursor: ChartCursor;
  readonly active: ActiveDay | null;
  readonly valueLabel: (value: number) => string;
  readonly children: ReactNode;
}

function activeText(active: ActiveDay, valueLabel: (value: number) => string): string {
  return `${formatDayLabel(active.date)}: ${active.value === null ? 'no sessions' : valueLabel(active.value)}`;
}

/**
 * The focusable plot: an accessible SVG (title + desc), a tooltip that follows the hovered or
 * focused day, and a polite live region that reads the day out when moved by keyboard.
 */
export function PlotShell({ title, desc, width, height, box, measureRef, cursor, active, valueLabel, children }: PlotShellProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const onRight = active !== null && active.x <= width / 2;
  const tipStyle = active === null
    ? undefined
    : { top: box.top, ...(onRight ? { left: active.x + TOOLTIP_OFFSET } : { right: width - active.x + TOOLTIP_OFFSET }) };
  return (
    <div
      ref={measureRef}
      className="ins-plot"
      role="group"
      tabIndex={0}
      aria-label={`${title}. Use the arrow keys to read each day.`}
      {...cursor.handlers}
    >
      <svg className="ins-svg" width={width} height={height} role="img" aria-labelledby={`${titleId} ${descId}`}>
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        {children}
      </svg>
      {active !== null ? (
        <div className="ins-tip" style={tipStyle} aria-hidden="true">
          <span className="ins-tip__value">
            <span className="ins-tip__key" />
            {active.value === null ? 'No sessions' : valueLabel(active.value)}
          </span>
          <span className="ins-tip__date">{formatDayLabel(active.date)}</span>
        </div>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {active !== null && cursor.viaKeyboard ? activeText(active, valueLabel) : ''}
      </p>
    </div>
  );
}

/** Quiet note shown in place of a chart that has nothing to draw. */
export function ChartMessage({ height, children }: { readonly height: number; readonly children: ReactNode }) {
  return (
    <p className="ins-chart-message" style={{ minHeight: height }}>
      {children}
    </p>
  );
}

/** Switches a section's charts to their table twins and back. */
export function TableToggle({ showTable, onToggle }: { readonly showTable: boolean; readonly onToggle: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon={showTable ? ChartColumn : Table2} onClick={onToggle}>
      {showTable ? 'Show as chart' : 'Show as table'}
    </Button>
  );
}

export interface TableRow {
  readonly key: string;
  /** First cell becomes the row header. */
  readonly cells: readonly ReactNode[];
}

export function DataTable({ caption, headers, rows }: { readonly caption: string; readonly headers: readonly string[]; readonly rows: readonly TableRow[] }) {
  return (
    <div className="ins-table-wrap">
      <table className="ins-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The table twin of a one-series day chart. Days without sessions say so instead of showing 0. */
export function SeriesTable({ caption, header, series, format }: { readonly caption: string; readonly header: string; readonly series: readonly DayValue[]; readonly format: (value: number) => string }) {
  const rows = series.map((day) => ({
    key: day.date,
    cells: [formatDayLabel(day.date), day.value === null ? <span className="ins-muted">No sessions</span> : format(day.value)],
  }));
  return <DataTable caption={caption} headers={['Day', header]} rows={rows} />;
}
