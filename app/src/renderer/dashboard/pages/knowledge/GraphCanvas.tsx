import type { CSSProperties } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import type { Fact, KnowledgeGraph } from '@shared/types';
import { IconButton, cx } from '../../../ui/components';
import { pluralize } from '../../../lib/format';
import { MAX_ZOOM, MIN_ZOOM, graphSummary } from './graph-math';
import { CATEGORY_NAMES } from './knowledge-model';
import { useGraphEngine, type HoverInfo } from './useGraphEngine';

/** Half the tooltip's max width (CSS), used to keep it inside the canvas. */
const TOOLTIP_HALF_WIDTH = 130;
const TOOLTIP_EDGE = 8;
const TOOLTIP_GAP = 8;
/** Room needed above a node for the tooltip; nearer the top edge it opens below instead. */
const TOOLTIP_ROOM_ABOVE = 110;
/** When opening below, also clear the node's own label (drawn under it on hover). */
const TOOLTIP_LABEL_CLEARANCE = 18;

export interface GraphCanvasProps {
  readonly graph: KnowledgeGraph;
  readonly facts: ReadonlyMap<string, Fact>;
  readonly reduceMotion: boolean;
  readonly onSelectFact: (fact: Fact) => void;
}

function opensBelow(hover: HoverInfo): boolean {
  return hover.y - hover.reach < TOOLTIP_ROOM_ABOVE;
}

function tooltipStyle(hover: HoverInfo): CSSProperties {
  const min = TOOLTIP_HALF_WIDTH + TOOLTIP_EDGE;
  const max = hover.canvasWidth - TOOLTIP_HALF_WIDTH - TOOLTIP_EDGE;
  const left = max > min ? Math.min(max, Math.max(min, hover.x)) : hover.canvasWidth / 2;
  const top = opensBelow(hover)
    ? hover.y + hover.reach + TOOLTIP_GAP + TOOLTIP_LABEL_CLEARANCE
    : hover.y - hover.reach - TOOLTIP_GAP;
  return { left, top };
}

function TooltipBody({ hover, graph, facts }: { readonly hover: HoverInfo; readonly graph: KnowledgeGraph; readonly facts: ReadonlyMap<string, Fact> }) {
  if (hover.kind === 'fact') {
    const fact = facts.get(hover.id);
    return (
      <>
        <span className="knowledge-graph__tip-title">{fact?.label ?? hover.label}</span>
        {fact ? <span className="knowledge-graph__tip-text">{fact.value}</span> : null}
        {fact ? <span className="knowledge-graph__tip-meta">{CATEGORY_NAMES[fact.category]} · Select to edit</span> : null}
      </>
    );
  }
  if (hover.kind === 'category') {
    const node = graph.nodes.find((n) => n.id === hover.id);
    const count = graph.nodes.filter((n) => n.kind === 'fact' && n.category !== null && n.category === node?.category).length;
    return (
      <>
        <span className="knowledge-graph__tip-title">{hover.label}</span>
        <span className="knowledge-graph__tip-meta">{pluralize(count, 'fact')}</span>
      </>
    );
  }
  return <span className="knowledge-graph__tip-title">You</span>;
}

/** The force-directed canvas plus its zoom controls and hover tooltip. */
export function GraphCanvas({ graph, facts, reduceMotion, onSelectFact }: GraphCanvasProps) {
  const engine = useGraphEngine({
    graph,
    reduceMotion,
    onSelect: (id) => {
      const fact = facts.get(id);
      if (fact) onSelectFact(fact);
    },
  });
  const { hover, zoom } = engine;
  return (
    <div className="knowledge-graph__stage">
      <canvas
        ref={engine.canvasRef}
        className="knowledge-graph__canvas"
        role="img"
        aria-label={graphSummary(graph)}
        tabIndex={-1}
        data-cursor="grab"
        onPointerDown={engine.onPointerDown}
        onPointerMove={engine.onPointerMove}
        onPointerUp={engine.onPointerUp}
        onPointerCancel={engine.onPointerCancel}
        onPointerLeave={engine.onPointerLeave}
      />
      {hover ? (
        <div className={cx('knowledge-graph__tooltip', opensBelow(hover) && 'knowledge-graph__tooltip--below')} style={tooltipStyle(hover)} aria-hidden>
          <TooltipBody hover={hover} graph={graph} facts={facts} />
        </div>
      ) : null}
      <div className="knowledge-graph__controls" role="group" aria-label="Zoom">
        <IconButton label="Zoom in" icon={ZoomIn} tooltipPlacement="below" aria-disabled={zoom >= MAX_ZOOM || undefined} onClick={engine.zoomIn} />
        <IconButton label="Zoom out" icon={ZoomOut} tooltipPlacement="below" aria-disabled={zoom <= MIN_ZOOM || undefined} onClick={engine.zoomOut} />
        <IconButton label="Reset view" icon={Maximize} tooltipPlacement="below" onClick={engine.resetView} />
      </div>
    </div>
  );
}
