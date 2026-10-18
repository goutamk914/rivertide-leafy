import { useId, useState, type FormEvent } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, ExternalLink, PlugZap } from 'lucide-react';
import type { ProviderTestResult, SecretStatus } from '@shared/ipc';
import { invoke } from '../../../lib/ipc';
import { Button, Field, ICON_STROKE, Skeleton, TextInput, cx } from '../../../ui/components';
import { formatTestResult, secretIdFor, type ProviderNeed } from './ai-presets';
import { InlineError } from './step-frame';
import { useAsyncAction } from './use-async-action';

const KEY_MAX = 500;

/** "Claude (Anthropic)" → "Claude". */
const shortName = (name: string) => name.replace(/\s*\(.*\)$/, '');

function KeyState({ saved }: { readonly saved: boolean | null }) {
  if (saved === null) return <Skeleton width={88} height={24} radius={999} />;
  const Icon = saved ? CircleCheck : CircleDashed;
  return (
    <span className={cx('onb-grant', saved ? 'onb-grant--granted' : 'onb-grant--not-yet')}>
      <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
      {saved ? 'Saved' : 'No key yet'}
    </span>
  );
}

function TestResult({ result }: { readonly result: ProviderTestResult | null }) {
  if (!result) return null;
  const Icon = result.ok ? CircleCheck : CircleAlert;
  return (
    <span className={cx('onb-test', result.ok ? 'onb-test--ok' : 'onb-test--fail')}>
      <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
      {formatTestResult(result)}
    </span>
  );
}

export interface ProviderRowProps {
  readonly need: ProviderNeed;
  /** Undefined while the saved-key status is loading. */
  readonly secrets: SecretStatus | undefined;
  readonly onSecrets: (secrets: SecretStatus) => void;
}

/** One provider the chosen setup uses: key field (when it needs one), where to get it, and a live test. */
export function ProviderRow({ need, secrets, onSecrets }: ProviderRowProps) {
  const titleId = useId();
  const secretId = secretIdFor(need);
  const name = shortName(need.info.name);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const save = useAsyncAction();
  const test = useAsyncAction();
  const link = useAsyncAction();
  const saved = secretId && secrets ? (secrets[secretId]?.set ?? false) : null;
  const keyUrl = need.info.keyUrl;

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!secretId || !value) return;
    const next = await save.run(() => invoke('secrets:set', { id: secretId, value }), (detail) => `The key wasn’t saved. ${detail}`);
    if (!next) return;
    setDraft('');
    setResult(null);
    onSecrets(next);
  };

  const runTest = async () => {
    setResult(null);
    const next = await test.run(
      () => invoke('providers:test', { kind: need.testKind, providerId: need.providerId }),
      (detail) => `The test didn’t run. ${detail}`,
    );
    if (next) setResult(next);
  };

  const openKeyPage = (url: string) => {
    void link.run(() => invoke('system:openExternal', { url }), (detail) => `Your browser didn’t open. ${detail}`);
  };

  return (
    <section className="onb-provider" aria-labelledby={titleId}>
      <div className="onb-provider__head">
        <div className="onb-provider__text">
          <h3 id={titleId} className="onb-provider__title">{need.info.name}</h3>
          <p className="onb-provider__purpose">{need.purpose}</p>
        </div>
        {secretId ? <KeyState saved={saved} /> : null}
      </div>
      {secretId ? (
        <form className="onb-provider__form" onSubmit={(event) => void saveKey(event)}>
          <Field label={`${name} key`} error={save.error}>
            <TextInput
              type="password"
              value={draft}
              maxLength={KEY_MAX}
              autoComplete="off"
              spellCheck={false}
              placeholder={saved ? 'Paste a new key to replace the saved one' : 'Paste your key'}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="ghost" loading={save.pending} disabled={!draft.trim()}>
            Save key
          </Button>
        </form>
      ) : (
        <p className="onb-provider__note">{need.info.note} You can finish this later in Settings.</p>
      )}
      <div className="onb-provider__actions">
        {keyUrl ? (
          <Button variant="quiet" icon={ExternalLink} loading={link.pending} onClick={() => openKeyPage(keyUrl)}>
            {secretId ? 'Get a key' : `Get ${name}`}
          </Button>
        ) : null}
        <Button variant="ghost" icon={PlugZap} loading={test.pending} onClick={() => void runTest()}>
          Test
        </Button>
        <span className="onb-provider__result" role="status">
          <TestResult result={result} />
        </span>
      </div>
      {test.error ? <InlineError>{test.error}</InlineError> : null}
      {link.error ? <InlineError>{link.error}</InlineError> : null}
    </section>
  );
}
