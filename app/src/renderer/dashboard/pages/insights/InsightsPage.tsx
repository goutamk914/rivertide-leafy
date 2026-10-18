/** Insights: usage and speech dynamics for one shared time range (the filter row scopes both). */
import { useEffect, useState } from 'react';
import { SegmentedControl, type SegmentOption } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { Page, type PageComponentProps } from '../../shell/Page';
import { DynamicsSection } from './DynamicsSection';
import { RANGE_OPTIONS, parseRange, type RangeDays } from './series';
import { UsageSection } from './UsageSection';
import './insights.css';
import './insights-charts.css';

const RANGE_SEGMENTS: readonly SegmentOption<string>[] = RANGE_OPTIONS.map((days) => ({ value: String(days), label: `${days} days` }));

export function InsightsPage({ route }: PageComponentProps) {
  // "/insights/30" opens on that range; anything else starts on the default.
  const [days, setDays] = useState<RangeDays>(() => parseRange(route.section));
  const calm = useCalm();

  useEffect(() => {
    if (route.section) setDays(parseRange(route.section));
  }, [route.section]);

  return (
    <Page title="Insights" description="How you use Rivertide, and how your speech compares with your own usual.">
      <div className="ins-filters">
        <SegmentedControl label="Time range" options={RANGE_SEGMENTS} value={String(days)} onChange={(value) => setDays(parseRange(value))} />
      </div>
      <div className="ins-sections">
        <UsageSection days={days} calm={calm} />
        <DynamicsSection days={days} calm={calm} />
      </div>
    </Page>
  );
}
