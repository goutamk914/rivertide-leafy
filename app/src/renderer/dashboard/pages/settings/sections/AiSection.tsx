import { PROVIDERS, type SecretId } from '@shared/settings';
import { invoke } from '../../../../lib/ipc';
import { useIpcQuery } from '../../../hooks/useIpc';
import { PageError } from '../../../shell/Page';
import { SectionFrame, SettingGroup } from '../parts/layout';
import { ProviderKeyCard } from '../parts/ProviderKeyCard';
import { ModelRoles } from './ModelRoles';
import { SpeechToTextSettings } from './SpeechToTextSettings';

/** Providers that need an API key (all of them are LLM providers; Groq, OpenAI and custom also do speech). */
const KEYED_PROVIDERS = PROVIDERS.filter((p) => p.needsKey);

export function AiSection() {
  const secrets = useIpcQuery(() => invoke('secrets:status', undefined), []);
  const setSecrets = (status: NonNullable<typeof secrets.data>) => secrets.mutate(() => status);

  return (
    <SectionFrame title="AI" description="Choose which AI services Rivertide uses, and add your keys.">
      <SettingGroup
        title="API keys"
        surface={false}
        description="Keys are encrypted and kept on this computer. Rivertide never shows a saved key again."
      >
        {secrets.error ? (
          <PageError message={`Rivertide couldn’t check which keys are saved. ${secrets.error}`} onRetry={secrets.reload} />
        ) : null}
        <div className="settings-key-grid">
          {KEYED_PROVIDERS.map((provider) => (
            <ProviderKeyCard
              key={provider.id}
              secretId={provider.id as SecretId}
              name={provider.name}
              note={provider.note}
              keyUrl={provider.keyUrl}
              isSet={secrets.data?.[provider.id as SecretId]?.set}
              test={{ kind: provider.llm ? 'llm' : 'stt', providerId: provider.id }}
              onStatus={setSecrets}
            />
          ))}
        </div>
      </SettingGroup>
      <ModelRoles />
      <SpeechToTextSettings secrets={secrets.data} onSecrets={setSecrets} />
    </SectionFrame>
  );
}
