import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Fact } from '@shared/types';
import { Button, Card, EmptyState, Skeleton } from '../../../ui/components';
import { invoke } from '../../../lib/ipc';
import { useIpcQuery } from '../../hooks/useIpc';
import { PageError } from '../../shell/Page';
import { FAMILY_NAMES, FAMILY_ORDER, factCount, familyCategories, type Family } from './graph-math';
import { CATEGORY_NAMES } from './knowledge-model';
import { GraphCanvas } from './GraphCanvas';
import { useReducedMotionPreference } from './useReducedMotionPreference';

/** Matches `.knowledge-graph__canvas` height so loading doesn't shift the layout. */
const GRAPH_HEIGHT_PX = 480;

const loadGraph = () => invoke('knowledge:graph', undefined);
const loadFacts = () => invoke('knowledge:list', {});

export interface GraphTabProps {
  readonly onEditFact: (fact: Fact) => void;
  readonly onAddFact: () => void;
}

function LegendItem({ family }: { readonly family: Family }) {
  const categories = familyCategories(family).map((category) => CATEGORY_NAMES[category]).join(', ');
  return (
    <li className="knowledge-legend__item">
      <span className={`knowledge-legend__swatch knowledge-legend__swatch--${family}`} aria-hidden />
      <span className="knowledge-legend__name">{FAMILY_NAMES[family]}</span>
      <span className="knowledge-legend__categories">{categories}</span>
    </li>
  );
}

function GraphLegend() {
  return (
    <ul className="knowledge-legend" aria-label="Colour key">
      {FAMILY_ORDER.map((family) => (
        <LegendItem key={family} family={family} />
      ))}
    </ul>
  );
}

/** "Graph" tab: a map of facts around "You", grouped by category and coloured by family. */
export function GraphTab({ onEditFact, onAddFact }: GraphTabProps) {
  const graph = useIpcQuery(loadGraph, [], ['knowledge']);
  const facts = useIpcQuery(loadFacts, [], ['knowledge']);
  const reduceMotion = useReducedMotionPreference();
  const factMap = useMemo(() => new Map((facts.data ?? []).map((fact) => [fact.id, fact])), [facts.data]);

  if (graph.loading || facts.loading) {
    return (
      <div role="status" aria-label="Loading the map">
        <Skeleton height={GRAPH_HEIGHT_PX} radius={18} />
      </div>
    );
  }
  const error = graph.error ?? facts.error;
  if (error) {
    const retry = () => {
      graph.reload();
      facts.reload();
    };
    return <PageError message={`Couldn’t load the map. ${error}`} onRetry={retry} />;
  }
  if (!graph.data || factCount(graph.data) === 0) {
    return (
      <EmptyState
        pose="sprouting"
        title="Nothing to map yet."
        action={<Button variant="primary" icon={Plus} onClick={onAddFact}>Add a fact</Button>}
      >
        Facts Leafy learns about you will show up here, grouped by topic.
      </EmptyState>
    );
  }
  return (
    <div className="knowledge-graph">
      <GraphLegend />
      <Card padding="flush">
        <GraphCanvas graph={graph.data} facts={factMap} reduceMotion={reduceMotion} onSelectFact={onEditFact} />
      </Card>
      <p className="knowledge-graph__hint">
        Drag the background to move around, scroll or use the buttons to zoom, and select a fact to edit it. The Facts tab lists
        everything here.
      </p>
    </div>
  );
}
