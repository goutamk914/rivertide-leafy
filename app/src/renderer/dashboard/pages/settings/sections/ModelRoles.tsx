import { useId } from 'react';
import { DEFAULT_MODEL, LLM_ROLES, PROVIDERS, type LlmProviderId, type LlmRole, type Settings, type SettingsPatch } from '@shared/settings';
import { Field, Select, type SelectOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { validateHttpUrl, validateModel, withBaseUrl } from '../model/settings-model';
import { SettingGroup } from '../parts/layout';
import { ProviderTest } from '../parts/ProviderTest';
import { TextSetting } from '../parts/TextSetting';

type RoleChoice = Settings['llm']['roles'][LlmRole];

export const ROLE_INFO: Readonly<Record<LlmRole, { readonly label: string; readonly description: string }>> = {
  polish: { label: 'Writing cleanup', description: 'Tidies up what you dictate before it’s pasted.' },
  answer: { label: 'Answers', description: 'Answers questions you ask with Control + fn.' },
  agent: { label: 'Leafy commands', description: 'Understands commands and decides what Leafy does.' },
  chat: { label: 'Chat', description: 'Talks with you on the Chat page.' },
  extract: { label: 'Memory', description: 'Picks out facts worth remembering.' },
};

const LLM_OPTIONS: readonly SelectOption<LlmProviderId>[] = PROVIDERS
  .filter((p) => p.llm)
  .map((p) => ({ value: p.id as LlmProviderId, label: p.name }));

const OLLAMA_DEFAULT_URL = PROVIDERS.find((p) => p.id === 'ollama')?.defaultBaseUrl ?? '';

function rolePatch(role: LlmRole, choice: RoleChoice): SettingsPatch {
  return { llm: { roles: { [role]: choice } } };
}

function RoleRow({ role, choice, onChange }: { readonly role: LlmRole; readonly choice: RoleChoice; readonly onChange: (next: RoleChoice) => void }) {
  const listId = useId();
  const suggestions = PROVIDERS.find((p) => p.id === choice.providerId)?.llmModels ?? [];
  const info = ROLE_INFO[role];
  return (
    <fieldset className="settings-role">
      <legend className="settings-role__legend">{info.label}</legend>
      <p className="settings-note">{info.description}</p>
      <div className="settings-role__fields">
        <Field label="Provider">
          <Select
            options={LLM_OPTIONS}
            value={choice.providerId}
            onChange={(providerId) => onChange({ providerId, model: DEFAULT_MODEL[providerId] })}
          />
        </Field>
        <TextSetting
          label="Model"
          help="Pick a suggestion or type any model name."
          value={choice.model}
          list={listId}
          validate={validateModel}
          onSave={(model) => onChange({ ...choice, model })}
        />
        <datalist id={listId}>
          {suggestions.map((model) => <option key={model} value={model} />)}
        </datalist>
      </div>
    </fieldset>
  );
}

/** Per-job provider and model, plus server addresses for the local and custom providers. */
export function ModelRoles() {
  const { llm } = useSettings();
  const update = useUpdateSettings();
  // baseUrls is replaced wholesale, so every change sends the complete record.
  const saveBaseUrl = (id: string, url: string) => void update({ llm: { baseUrls: withBaseUrl(llm.baseUrls, id, url) } });

  return (
    <>
      <SettingGroup title="Models" description="Choose which service and model does each job.">
        {LLM_ROLES.map((role) => (
          <RoleRow key={role} role={role} choice={llm.roles[role]} onChange={(next) => void update(rolePatch(role, next))} />
        ))}
      </SettingGroup>

      <SettingGroup title="Server addresses" description="Only needed for Ollama on this computer or a custom server.">
        <TextSetting
          label="Ollama address"
          help={`Leave empty to use ${OLLAMA_DEFAULT_URL}.`}
          placeholder={OLLAMA_DEFAULT_URL}
          value={llm.baseUrls.ollama ?? ''}
          validate={(url) => validateHttpUrl(url)}
          optional
          onSave={(url) => saveBaseUrl('ollama', url)}
        />
        <ProviderTest kind="llm" providerId="ollama" name="Ollama" />
        <TextSetting
          label="Custom server address"
          help="An OpenAI-compatible endpoint, such as https://example.com/v1."
          value={llm.baseUrls.custom ?? ''}
          validate={(url) => validateHttpUrl(url)}
          optional
          onSave={(url) => saveBaseUrl('custom', url)}
        />
      </SettingGroup>
    </>
  );
}
