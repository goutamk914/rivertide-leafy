import type { CSSProperties } from 'react';

/**
 * An example of what Rivertide remembers: people, medicines, appointments and symptoms you have
 * mentioned, linked together. HTML nodes keep the text readable at any width; the links are
 * hand-drawn curves in a stretched SVG that draws itself in when it scrolls into view.
 */

type Kind = 'You' | 'Person' | 'Medicine' | 'Appointment' | 'Symptom';

interface GraphNode {
  readonly id: string;
  readonly kind: Kind;
  readonly name: string;
  readonly note?: string;
  /** Centre position in percent: [desktop x, desktop y, narrow x, narrow y]. */
  readonly at: readonly [number, number, number, number];
}

const NODES: readonly GraphNode[] = [
  { id: 'you', kind: 'You', name: 'You', at: [50, 50, 50, 45] },
  { id: 'rao', kind: 'Person', name: 'Dr. Rao', note: 'Oncologist', at: [18, 22, 26, 8] },
  { id: 'infusion', kind: 'Appointment', name: 'Infusion', note: 'Wednesdays, 9:00', at: [80, 22, 74, 24] },
  { id: 'priya', kind: 'Person', name: 'Priya', note: 'Sister, drives on Wednesdays', at: [16, 78, 26, 66] },
  { id: 'ondansetron', kind: 'Medicine', name: 'Ondansetron', note: 'Before each infusion', at: [84, 76, 74, 71] },
  { id: 'tired', kind: 'Symptom', name: 'Tired after infusions', note: 'Usually two days', at: [52, 90, 50, 92] },
];

const LINKS: readonly (readonly [string, string])[] = [
  ['you', 'rao'],
  ['you', 'infusion'],
  ['you', 'priya'],
  ['rao', 'infusion'],
  ['infusion', 'ondansetron'],
  ['priya', 'infusion'],
  ['you', 'tired'],
  ['infusion', 'tired'],
];

const byId = new Map(NODES.map((node) => [node.id, node]));

/** A slightly bowed curve between two points, so the links read as drawn by hand. */
function curve(ax: number, ay: number, bx: number, by: number, bow: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / length) * bow;
  const cy = my + (dx / length) * bow;
  return `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function Links({ narrow }: { readonly narrow: boolean }) {
  const offset = narrow ? 2 : 0;
  return (
    <svg
      className={`graph__links rt-doodle ${narrow ? 'graph__links--narrow' : 'graph__links--wide'}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {LINKS.map(([from, to], index) => {
        const a = byId.get(from);
        const b = byId.get(to);
        if (!a || !b) return null;
        const d = curve(a.at[offset], a.at[offset + 1], b.at[offset], b.at[offset + 1], index % 2 === 0 ? 4 : -4);
        return <path key={`${from}-${to}`} d={d} pathLength={1} vectorEffect="non-scaling-stroke" style={{ '--i': index } as CSSProperties} />;
      })}
    </svg>
  );
}

export function KnowledgeGraph() {
  return (
    <figure className="graph">
      <div className="graph__canvas">
        <Links narrow={false} />
        <Links narrow />
        <ul className="graph__nodes" aria-label="Example of what Rivertide remembers">
          {NODES.map((node, index) => (
            <li
              key={node.id}
              className={node.kind === 'You' ? 'graph__node graph__node--you rt-reveal' : 'graph__node rt-reveal'}
              style={
                {
                  '--x': `${node.at[0]}%`,
                  '--y': `${node.at[1]}%`,
                  '--x-sm': `${node.at[2]}%`,
                  '--y-sm': `${node.at[3]}%`,
                  '--reveal-delay': `${index * 90}ms`,
                } as CSSProperties
              }
            >
              {node.kind === 'You' ? null : <span className="graph__kind">{node.kind}</span>}
              <span className="graph__name">{node.name}</span>
              {node.note ? <span className="graph__note">{node.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="graph__caption">
        An example. Rivertide keeps this as plain files on your Mac, and you can read, change or delete any of it.
      </figcaption>
    </figure>
  );
}
