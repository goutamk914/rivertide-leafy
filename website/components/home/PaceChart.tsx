'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PACE_DAYS, USUAL_RANGE, describeDay } from '@/content/pace';

/** Plot geometry in CSS pixels (the SVG is drawn 1:1 with its measured width). */
const HEIGHT = 240;
const PAD = { top: 16, right: 64, bottom: 30, left: 36 } as const;
const Y_MIN = 100;
const Y_MAX = 150;
const Y_TICKS = [100, 120, 140];
const DEFAULT_WIDTH = 560;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Example speaking pace against your usual range. One series, one axis, a recessive grid,
 * the endpoint and the low point labelled, a crosshair on hover or arrow keys, and the
 * same numbers in a table underneath.
 */
export function PaceChart() {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const plotWidth = Math.max(160, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const last = PACE_DAYS.length - 1;

  const x = (index: number) => PAD.left + (plotWidth * index) / last;
  const y = (value: number) => PAD.top + plotHeight * (1 - (value - Y_MIN) / (Y_MAX - Y_MIN));
  const line = PACE_DAYS.map((day, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(day.wpm).toFixed(1)}`).join(' ');
  const lowIndex = PACE_DAYS.reduce((low, day, index) => (day.wpm < PACE_DAYS[low].wpm ? index : low), 0);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD.left) / plotWidth;
    setActive(Math.min(last, Math.max(0, Math.round(ratio * last))));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') return setActive(null);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return undefined;
    event.preventDefault();
    setActive((current) => Math.min(last, Math.max(0, (current ?? (step > 0 ? -1 : last + 1)) + step)));
    return undefined;
  };

  const shown = active === null ? null : PACE_DAYS[active];

  return (
    <figure className="pace" aria-labelledby={titleId}>
      <figcaption id={titleId} className="pace__title">
        Speaking pace, words a minute <span className="pace__example">Example</span>
      </figcaption>
      <div ref={frame} className="pace__frame">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="pace__svg"
          tabIndex={0}
          role="group"
          aria-label={`Example speaking pace over two weeks. Usual range ${USUAL_RANGE.low} to ${USUAL_RANGE.high} words a minute; lowest ${PACE_DAYS[lowIndex].wpm} on ${PACE_DAYS[lowIndex].date}. Use the left and right arrow keys to read each day.`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="pace__tick">
                {tick}
              </text>
            </g>
          ))}
          <rect x={PAD.left} y={y(USUAL_RANGE.high)} width={plotWidth} height={y(USUAL_RANGE.low) - y(USUAL_RANGE.high)} fill="var(--chart-band)" />
          <text x={PAD.left + 10} y={y(USUAL_RANGE.high) + 16} className="pace__band-label">
            Your usual
          </text>
          {PACE_DAYS.map((day, index) => (
            <text key={day.date} x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="pace__tick">
              {day.short}
            </text>
          ))}
          {shown !== null && active !== null ? (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--hairline-strong)" strokeWidth={1} />
          ) : null}
          <path d={line} fill="none" stroke="var(--chart-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(lowIndex)} cy={y(PACE_DAYS[lowIndex].wpm)} r={4} fill="var(--chart-series)" stroke="var(--surface-1)" strokeWidth={2} />
          <text x={x(lowIndex)} y={y(PACE_DAYS[lowIndex].wpm) + 20} textAnchor="middle" className="pace__value">
            {PACE_DAYS[lowIndex].wpm}
          </text>
          <circle cx={x(last)} cy={y(PACE_DAYS[last].wpm)} r={4} fill="var(--chart-series)" stroke="var(--surface-1)" strokeWidth={2} />
          <text x={x(last) + 10} y={y(PACE_DAYS[last].wpm)} dy="0.32em" className="pace__value">
            {PACE_DAYS[last].wpm}
          </text>
          {active !== null ? (
            <circle cx={x(active)} cy={y(PACE_DAYS[active].wpm)} r={5} fill="var(--chart-series)" stroke="var(--surface-1)" strokeWidth={2} />
          ) : null}
        </svg>
        {shown && active !== null ? (
          <div
            className="pace__tooltip"
            style={{ left: Math.min(Math.max(x(active), 90), width - 90), top: Math.max(y(shown.wpm) - 74, 0) }}
            aria-hidden="true"
          >
            <span className="pace__tooltip-value">{shown.wpm}</span>
            <span className="pace__tooltip-label">{shown.date}</span>
            <span className="pace__tooltip-label">{describeDay(shown.wpm)}</span>
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {shown ? `${shown.date}: ${shown.wpm} words a minute, ${describeDay(shown.wpm)}.` : ''}
        </p>
      </div>
      <details className="pace__table">
        <summary>Show the numbers</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Words a minute</th>
              <th scope="col">Compared with usual</th>
            </tr>
          </thead>
          <tbody>
            {PACE_DAYS.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.date}</th>
                <td className="tabular">{day.wpm}</td>
                <td>{describeDay(day.wpm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
