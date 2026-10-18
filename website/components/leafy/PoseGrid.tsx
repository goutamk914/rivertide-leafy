'use client';

import { useMemo, useState } from 'react';
import { LeafySprite, POSE_CATEGORIES, POSE_NAMES, type PoseCategory, type PoseName } from '@rivertide/leafy';

type Filter = 'all' | PoseCategory;

const LABELS: Record<Filter, string> = {
  all: 'All',
  thinking: 'Thinking',
  emotions: 'Feelings',
  actions: 'Actions',
  work: 'Work',
  celebrate: 'Celebrate',
  nature: 'Nature',
};

const FILTERS = Object.keys(LABELS) as Filter[];

const humanize = (name: PoseName) => name.replace(/-/g, ' ');

/** All 100 poses from the Leafy pose pack, filterable by category, each with its name. */
export function PoseGrid() {
  const [filter, setFilter] = useState<Filter>('all');
  const poses = useMemo<readonly PoseName[]>(() => (filter === 'all' ? POSE_NAMES : POSE_CATEGORIES[filter]), [filter]);

  return (
    <div className="poses">
      <div role="group" aria-label="Filter poses" className="poses__filters">
        {FILTERS.map((item) => {
          const count = item === 'all' ? POSE_NAMES.length : POSE_CATEGORIES[item].length;
          return (
            <button key={item} type="button" className="poses__filter" aria-pressed={item === filter} onClick={() => setFilter(item)}>
              {LABELS[item]} <span className="poses__count tabular">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        Showing {poses.length} poses.
      </p>
      <ul className="poses__grid">
        {poses.map((name) => (
          <li key={name} className="poses__tile">
            <LeafySprite pose={name} scale={3} decorative />
            <span className="poses__name">{humanize(name)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
