import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { errorMessage, invoke } from '../../../../lib/ipc';
import { Button, Field, Select, Toggle, toast } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { retentionOptions } from '../model/settings-model';
import { SectionFrame, SettingGroup, SettingNote } from '../parts/layout';
import { WipeDataDialog } from './WipeDataDialog';

function ExportButton() {
  const [exporting, setExporting] = useState(false);
  const exportAll = async () => {
    setExporting(true);
    try {
      const { path } = await invoke('data:export', undefined);
      toast.success(`Your data was copied to ${path}`);
    } catch (error) {
      toast.error(`Rivertide couldn’t export your data. ${errorMessage(error)}`);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Button icon={Download} loading={exporting} onClick={() => void exportAll()}>
      Export my data
    </Button>
  );
}

export function PrivacySection() {
  const { privacy, knowledge, insights } = useSettings();
  const update = useUpdateSettings();
  const [wipeOpen, setWipeOpen] = useState(false);

  return (
    <SectionFrame title="Privacy & data" description="Rivertide stores your data on this computer. To write and answer, it sends your words to the AI services you chose under AI.">
      <SettingGroup title="History">
        <Toggle
          label="Keep history"
          description="Saves what you dictate, ask and command so you can find it again in History."
          checked={privacy.historyEnabled}
          onChange={(historyEnabled) => void update({ privacy: { historyEnabled } })}
        />
        <Field label="Keep history for" help="Older items are deleted automatically.">
          <Select
            options={retentionOptions(privacy.retentionDays)}
            value={String(privacy.retentionDays)}
            disabled={!privacy.historyEnabled}
            onChange={(days) => void update({ privacy: { retentionDays: Number(days) } })}
          />
        </Field>
      </SettingGroup>

      <SettingGroup title="Learning">
        <Toggle
          label="Remember facts from what I say"
          description="Leafy saves useful details, like names and dates, to Memory. You can edit or delete them in Knowledge."
          checked={knowledge.autoExtract}
          onChange={(autoExtract) => void update({ knowledge: { autoExtract } })}
        />
        <Toggle
          label="Learn my words"
          description="Adds names and unusual words you say to your dictionary so they’re spelled right next time."
          checked={knowledge.learnDictionary}
          onChange={(learnDictionary) => void update({ knowledge: { learnDictionary } })}
        />
        <Toggle
          label="Speech dynamics"
          description="Measures your pace, pauses and filler words from your own speech to show trends in Insights. Not a diagnosis."
          checked={insights.dynamicsEnabled}
          onChange={(dynamicsEnabled) => void update({ insights: { dynamicsEnabled } })}
        />
      </SettingGroup>

      <SettingGroup title="Your data">
        <SettingNote>
          Export saves a copy of your settings, history, notes, reminders, memory, dictionary, chats and documents to a
          folder. API keys are not included.
        </SettingNote>
        <div className="settings-actions">
          <ExportButton />
        </div>
      </SettingGroup>

      <SettingGroup title="Delete all data" description="Removes everything Rivertide keeps on this computer, including your API keys. This can’t be undone.">
        <div className="settings-actions">
          <Button variant="danger" icon={Trash2} onClick={() => setWipeOpen(true)}>
            Delete all data…
          </Button>
        </div>
      </SettingGroup>
      <WipeDataDialog open={wipeOpen} onClose={() => setWipeOpen(false)} />
    </SectionFrame>
  );
}
