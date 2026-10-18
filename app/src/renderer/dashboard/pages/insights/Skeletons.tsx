/** Chart-shaped placeholders for the first load (refetches keep the old charts instead). */
import type { ReactNode } from 'react';
import { Card, Skeleton } from '../../../ui/components';

/** Fixed column heights (fractions of the plot) so the placeholder never jumps between renders. */
const COLUMN_PATTERN = [0.35, 0.6, 0.45, 0.8, 0.5, 0.7, 0.4, 0.9, 0.55, 0.65, 0.3, 0.75, 0.5, 0.6];
const KPI_TILES = 4;
const BAR_ROWS = [0.9, 0.7, 0.5, 0.35, 0.2];
const KPI_HEIGHT = 112;
const SMALL_MULTIPLES = 3;
const TITLE_WIDTH = 160;
const TITLE_HEIGHT = 18;
const LINE_PATH = 'M0,70 C40,60 60,30 100,38 S160,72 200,56 S260,20 300,30 S360,64 400,48';

function FigureSkeleton({ children }: { readonly children: ReactNode }) {
  return (
    <Card className="ins-figure">
      <Skeleton width={TITLE_WIDTH} height={TITLE_HEIGHT} />
      {children}
    </Card>
  );
}

export function ColumnsSkeleton({ height }: { readonly height: number }) {
  return (
    <FigureSkeleton>
      <div className="ins-skel-columns" style={{ height }}>
        {COLUMN_PATTERN.map((fraction, i) => (
          <Skeleton key={i} height={`${fraction * 100}%`} radius={4} className="ins-skel-column" />
        ))}
      </div>
    </FigureSkeleton>
  );
}

export function LineSkeleton({ height }: { readonly height: number }) {
  return (
    <FigureSkeleton>
      <svg className="ins-skel-line" style={{ height }} viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={LINE_PATH} vectorEffect="non-scaling-stroke" />
      </svg>
    </FigureSkeleton>
  );
}

export function BarsSkeleton() {
  return (
    <FigureSkeleton>
      <div className="ins-bars">
        {BAR_ROWS.map((fraction, i) => (
          <div key={i} className="ins-bars__row">
            <Skeleton width="40%" height={14} />
            <Skeleton width={`${fraction * 100}%`} height={8} radius={4} className="ins-skel-bar" />
          </div>
        ))}
      </div>
    </FigureSkeleton>
  );
}

export function KpiSkeleton() {
  return (
    <div className="ins-kpis">
      {Array.from({ length: KPI_TILES }, (_, i) => (
        <Skeleton key={i} height={KPI_HEIGHT} radius={18} />
      ))}
    </div>
  );
}

export function UsageSkeleton({ calm, chartHeight }: { readonly calm: boolean; readonly chartHeight: number }) {
  return (
    <div role="status" aria-label="Loading usage" className="ins-stack">
      <KpiSkeleton />
      {calm ? null : (
        <div className="ins-usage-grid">
          <ColumnsSkeleton height={chartHeight} />
          <BarsSkeleton />
        </div>
      )}
    </div>
  );
}

export function DynamicsSkeleton({ calm, chartHeight, smallHeight }: { readonly calm: boolean; readonly chartHeight: number; readonly smallHeight: number }) {
  return (
    <div role="status" aria-label="Loading speech dynamics" className="ins-stack">
      <Skeleton height={56} radius={18} />
      <LineSkeleton height={chartHeight} />
      {calm ? null : (
        <div className="ins-multiples">
          {Array.from({ length: SMALL_MULTIPLES }, (_, i) => (
            <LineSkeleton key={i} height={smallHeight} />
          ))}
        </div>
      )}
    </div>
  );
}
