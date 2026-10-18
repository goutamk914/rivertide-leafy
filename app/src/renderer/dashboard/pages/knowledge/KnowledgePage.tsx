import { useCallback, useEffect, useState } from 'react';
import { BookA, List, Network } from 'lucide-react';
import type { Fact } from '@shared/types';
import { SegmentedControl, TabPanel, type SegmentOption } from '../../../ui/components';
import { invoke } from '../../../lib/ipc';
import { navigate, routePath } from '../../../lib/router';
import { useCalm } from '../../app-context';
import { useItemLookup, useMissingItem } from '../../hooks/useMissingItem';
import { Page, type PageComponentProps } from '../../shell/Page';
import { DictionaryTab } from './DictionaryTab';
import { FactDialog } from './FactDialog';
import { FactsTab } from './FactsTab';
import { GraphTab } from './GraphTab';
import { KNOWLEDGE_TABS, tabFromSection, type KnowledgeTab } from './knowledge-model';
import './knowledge.css';

const ID_BASE = 'knowledge';
export const MISSING_FACT = 'That fact isn’t here any more. It may have been deleted.';
const lookupFact = (id: string) => invoke('knowledge:list', {}).then((facts) => facts.find((f) => f.id === id) ?? null);
const isTab = (section: string): boolean => (KNOWLEDGE_TABS as readonly string[]).includes(section);

/** `/knowledge/<fact id>` (from the palette) opens that fact's editor over the Facts tab. */
function useFactLink(section: string | null, open: (fact: Fact) => void): void {
  const factId = section && !isTab(section) ? section : null;
  const lookup = useItemLookup(factId, true, lookupFact);
  useMissingItem(lookup.status === 'missing', routePath('knowledge', 'facts'), MISSING_FACT);
  useEffect(() => {
    if (lookup.status !== 'found' || !lookup.item) return;
    open(lookup.item);
    navigate(routePath('knowledge', 'facts'), { replace: true });
  }, [lookup.status, lookup.item, open]);
}

const TAB_OPTIONS: readonly SegmentOption<KnowledgeTab>[] = [
  { value: 'facts', label: 'Facts', icon: List },
  { value: 'graph', label: 'Graph', icon: Network },
  { value: 'dictionary', label: 'Dictionary', icon: BookA },
];

/** Follows `/knowledge/<section>` when the route changes (adjusting state during render, not in an effect). */
function useRouteTab(section: string | null): readonly [KnowledgeTab, (next: KnowledgeTab) => void] {
  const [tab, setTab] = useState<KnowledgeTab>(() => tabFromSection(section));
  const [seenSection, setSeenSection] = useState(section);
  if (section !== seenSection) {
    setSeenSection(section);
    setTab(tabFromSection(section));
  }
  const choose = useCallback((next: KnowledgeTab) => {
    setTab(next);
    navigate(routePath('knowledge', next), { replace: true });
  }, []);
  return [tab, choose] as const;
}

export function KnowledgePage({ route }: PageComponentProps) {
  const calm = useCalm();
  const [tab, chooseTab] = useRouteTab(route.section);
  const [editor, setEditor] = useState<{ readonly fact: Fact | null } | null>(null);
  const editFact = useCallback((fact: Fact) => setEditor({ fact }), []);
  const addFact = useCallback(() => setEditor({ fact: null }), []);
  useFactLink(route.section, editFact);

  const active: KnowledgeTab = calm ? 'facts' : tab;
  const panel =
    active === 'graph' ? <GraphTab onEditFact={editFact} onAddFact={addFact} />
      : active === 'dictionary' ? <DictionaryTab />
        : <FactsTab onEdit={editFact} onAdd={addFact} />;

  return (
    <Page title="Knowledge" description="What Leafy remembers about you. Edit or remove anything.">
      {calm ? (
        <div className="knowledge-panel">{panel}</div>
      ) : (
        <>
          <SegmentedControl mode="tabs" idBase={ID_BASE} label="Knowledge views" options={TAB_OPTIONS} value={active} onChange={chooseTab} className="knowledge-tabs" />
          <TabPanel idBase={ID_BASE} value={active} className="knowledge-panel">
            {panel}
          </TabPanel>
        </>
      )}
      {editor ? <FactDialog fact={editor.fact} onClose={() => setEditor(null)} /> : null}
    </Page>
  );
}
