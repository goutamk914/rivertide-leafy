import { ArrowRight, Bell, Timer } from 'lucide-react';
import type { DynamicsSummary, FogLabel, HistoryItem, Reminder, UsageSummary } from '@shared/types';
import { firstLine, formatClock, formatCount, formatDayHeading, formatRelative } from '../../../lib/format';
import { Card, ICON_STROKE, Skeleton } from '../../../ui/components';
import { ModeBadge } from '../../components/ModeBadge';
import { Sparkline } from '../../components/Sparkline';
import { PageError } from '../../shell/Page';

const FOG_SENTENCES: Readonly<Record<FogLabel, string>> = {
  steady: 'Your speech looks steady today.',
  'a-little-foggy': 'Your speech looks a little foggier than usual today.',
  foggy: 'Your speech looks foggier than usual today. Go easy on yourself.',
};

export function fogSentence(label: FogLabel): string {
  return FOG_SENTENCES[label];
}

interface Loadable<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly reload: () => void;
}

export function TodayCard({ usage }: { readonly usage: Loadable<UsageSummary> }) {
  const today = usage.data?.daily[usage.data.daily.length - 1];
  return (
    <Card as="section" className="home__today" aria-labelledby="home-today">
      <h2 id="home-today" className="home-label">Today so far</h2>
      {usage.error ? <PageError message={usage.error} onRetry={usage.reload} /> : (
        <div className="home-stats">
          {[
            { label: 'words spoken', value: today?.words },
            { label: today?.sessions === 1 ? 'session' : 'sessions', value: today?.sessions },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="home-stat__value tabular">{stat.value === undefined ? <Skeleton width={72} height={36} /> : formatCount(stat.value)}</div>
              <div className="home-stat__label">{stat.label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function FogCard({ dynamics }: { readonly dynamics: Loadable<DynamicsSummary> }) {
  const data = dynamics.data;
  let body;
  if (dynamics.error) body = <PageError message={dynamics.error} onRetry={dynamics.reload} />;
  else if (!data) body = <Skeleton height={48} />;
  else if (!data.baselineReady || !data.latest) body = <p className="muted">Insights appear after a few days of talking with Rivertide.</p>;
  else {
    body = (
      <div className="home-fog">
        <div>
          <p className="home-fog__sentence">{fogSentence(data.latest.label)}</p>
          <p className="home-fog__note">Compared only with your own recent days. Not a diagnosis. <a href="#/insights">See insights</a></p>
        </div>
        <Sparkline values={data.daily.map((d) => d.fogIndex)} width={168} height={44} label="Fog index over the last 14 days. Lower is clearer." />
      </div>
    );
  }
  return (
    <Card as="section" className="home__fog" aria-labelledby="home-fog">
      <h2 id="home-fog" className="home-label">How your speech is doing</h2>
      {body}
    </Card>
  );
}

interface ListCardProps<T> {
  readonly error: string | null;
  readonly reload: () => void;
  readonly now: Date;
  readonly items: readonly T[] | undefined;
}

export function RecentActivity({ items, error, reload, now }: ListCardProps<HistoryItem>) {
  let body;
  if (error) body = <PageError message={error} onRetry={reload} />;
  else if (!items) body = <div style={{ display: 'grid', gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>;
  else if (items.length === 0) body = <p className="muted">Nothing yet today. Hold fn and say something to get started.</p>;
  else {
    body = (
      <ul className="home-list">
        {items.map((item) => (
          <li key={item.id}>
            <a className="home-row" href={`#/history/${item.id}`}>
              <span className="home-row__time">{formatClock(item.createdAt)}</span>
              <span className="home-row__text">{firstLine(item.mode === 'dictate' ? item.output || item.raw : item.raw, 90)}</span>
              <ModeBadge mode={item.mode} />
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card as="section" className="home__recent" aria-labelledby="home-recent">
      <h2 id="home-recent" className="home-label">Recent activity{items && items[0] ? ` · ${formatRelative(items[0].createdAt, now)}` : ''}</h2>
      {body}
      <div className="home-card-foot">
        <a href="#/history" className="rt-status">
          See all history <ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </a>
      </div>
    </Card>
  );
}

export function UpcomingReminders({ items: reminders, error, reload, now }: ListCardProps<Reminder>) {
  const upcoming = (reminders ?? []).filter((r) => r.status === 'scheduled' && Date.parse(r.dueAt) >= now.getTime()).slice(0, 4);
  let body;
  if (error) body = <PageError message={error} onRetry={reload} />;
  else if (!reminders) body = <Skeleton height={88} />;
  else if (upcoming.length === 0) body = <p className="muted">No reminders coming up. Say “remind me…” to Leafy to add one.</p>;
  else {
    body = (
      <ul className="home-list">
        {upcoming.map((r) => {
          const Icon = r.kind === 'timer' ? Timer : Bell;
          return (
            <li key={r.id} className="home-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
              <Icon size={18} strokeWidth={ICON_STROKE} aria-label={r.kind === 'timer' ? 'Timer' : 'Reminder'} />
              <span className="home-row__text">{r.text}</span>
              <span className="home-row__time">
                {formatDayHeading(r.dueAt, now) === 'Today' ? formatClock(r.dueAt) : `${formatDayHeading(r.dueAt, now)}, ${formatClock(r.dueAt)}`}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <Card as="section" className="home__reminders" aria-labelledby="home-reminders">
      <h2 id="home-reminders" className="home-label">Coming up</h2>
      {body}
      <div className="home-card-foot">
        <a href="#/notes" className="rt-status">
          Notes &amp; reminders <ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </a>
      </div>
    </Card>
  );
}
