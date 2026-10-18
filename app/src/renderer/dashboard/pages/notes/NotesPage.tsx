import { Bell, NotebookPen } from 'lucide-react';
import { navigate } from '../../../lib/router';
import { SegmentedControl, TabPanel } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { Page, type PageComponentProps } from '../../shell/Page';
import { NotesPanel } from './NotesPanel';
import { RemindersPanel } from './RemindersPanel';
import './notes.css';

const TABS_ID = 'notes-tabs';
const REMINDERS = 'reminders';
type Tab = 'notes' | 'reminders';

export function NotesPage({ route }: PageComponentProps) {
  const calm = useCalm();
  const tab: Tab = route.section === REMINDERS ? 'reminders' : 'notes';
  const setTab = (next: Tab) => navigate(next === 'reminders' ? `/notes/${REMINDERS}` : '/notes', { replace: true });

  return (
    <Page title="Notes & reminders" layout="split">
      <div className="notes">
        <SegmentedControl
          mode="tabs"
          idBase={TABS_ID}
          label="Notes and reminders"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'notes', label: 'Notes', icon: NotebookPen },
            { value: 'reminders', label: 'Reminders', icon: Bell },
          ]}
          className="notes-tabs"
        />
        <TabPanel idBase={TABS_ID} value={tab} className="notes-tabpanel">
          {tab === 'notes' ? <NotesPanel section={route.section} /> : <RemindersPanel calm={calm} />}
        </TabPanel>
      </div>
    </Page>
  );
}
