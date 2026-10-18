import { useId } from 'react';
import type { SecretStatus } from '@shared/ipc';
import { PROVIDERS, STT_PROVIDER_IDS, type SettingsPatch, type SttProviderId } from '@shared/settings';
import { Field, Select, type SelectOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { providerName, sttModelFor, validateHttpUrl, validateLanguage, validateModel, validatePath } from '../model/settings-model';
import { SettingGroup, SettingNote } from '../parts/layout';
import { ProviderKeyCard } from '../parts/ProviderKeyCard';
import { ProviderTest } from '../parts/ProviderTest';
import { TextSetting } from '../parts/TextSetting';

const STT_OPTIONS: readonly SelectOption<SttProviderId>[] = STT_PROVIDER_IDS.map((id) => ({ value: id, label: providerName(id) }));

const lowerTrimmed = (value: string): string => value.trim().toLowerCase();

export interface SpeechToTextSettingsProps {
  readonly secrets: SecretStatus | undefined;
  readonly onSecrets: (status: SecretStatus) => void;
}

function CustomServer({ secrets, onSecrets, baseUrl, onBaseUrl }: SpeechToTextSettingsProps & {
  readonly baseUrl: string;
  readonly onBaseUrl: (url: string) => void;
}) {
  return (
    <>
      <TextSetting
        label="Speech-to-text server address"
        help="An OpenAI-compatible endpoint, such as https://example.com/v1."
        value={baseUrl}
        validate={(url) => validateHttpUrl(url, { required: true })}
        onSave={onBaseUrl}
      />
      <ProviderKeyCard
        secretId="stt-custom"
        name="Custom speech-to-text"
        note="This key is used only for your custom speech-to-text server. Skip it if the server doesn’t need one."
        keyUrl={null}
        isSet={secrets?.['stt-custom'].set}
        test={{ kind: 'stt', providerId: 'custom' }}
        onStatus={onSecrets}
      />
    </>
  );
}

/** Speech-to-text provider, model and language, plus the extra fields custom and local providers need. */
export function SpeechToTextSettings({ secrets, onSecrets }: SpeechToTextSettingsProps) {
  const { stt } = useSettings();
  const update = useUpdateSettings();
  const listId = useId();
  const info = PROVIDERS.find((p) => p.id === stt.providerId);
  const save = (patch: NonNullable<SettingsPatch['stt']>) => void update({ stt: patch });
  const sharesLlmKey = stt.providerId === 'groq' || stt.providerId === 'openai';

  return (
    <SettingGroup title="Speech to text" description="Turns your voice into words before anything else happens.">
      <Field label="Provider" help={info?.note}>
        <Select
          options={STT_OPTIONS}
          value={stt.providerId}
          onChange={(providerId) => save({ providerId, model: sttModelFor(providerId, stt.model) })}
        />
      </Field>
      {sharesLlmKey ? <SettingNote>Uses the {providerName(stt.providerId)} key above.</SettingNote> : null}
      <TextSetting
        label="Model"
        help="Pick a suggestion or type any model name."
        value={stt.model}
        list={listId}
        validate={validateModel}
        onSave={(model) => save({ model })}
      />
      <datalist id={listId}>
        {(info?.sttModels ?? []).map((model) => <option key={model} value={model} />)}
      </datalist>
      <TextSetting
        label="Language"
        help="Type auto to detect it, or a two-letter code like en or es."
        value={stt.language}
        normalize={lowerTrimmed}
        validate={validateLanguage}
        onSave={(language) => save({ language })}
      />
      {stt.providerId === 'custom' ? (
        <CustomServer
          secrets={secrets}
          onSecrets={onSecrets}
          baseUrl={stt.customBaseUrl}
          onBaseUrl={(customBaseUrl) => save({ customBaseUrl })}
        />
      ) : null}
      {stt.providerId === 'local' ? (
        <>
          <TextSetting
            label="whisper-cli location"
            help="The full path to whisper-cli, for example /opt/homebrew/bin/whisper-cli."
            value={stt.localBinaryPath}
            validate={validatePath}
            onSave={(localBinaryPath) => save({ localBinaryPath })}
          />
          <TextSetting
            label="Model file"
            help="The full path to a whisper.cpp model file (ending in .bin)."
            value={stt.localModelPath}
            validate={validatePath}
            onSave={(localModelPath) => save({ localModelPath })}
          />
          <ProviderTest kind="stt" providerId="local" name="whisper.cpp" />
        </>
      ) : null}
    </SettingGroup>
  );
}
