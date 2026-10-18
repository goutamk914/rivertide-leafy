import { useState } from 'react';
import {
  Accessibility, ArrowRight, Ban, CircleCheck, CircleDashed, ExternalLink, Keyboard, Mic, type LucideIcon,
} from 'lucide-react';
import type { PermissionStatus } from '@shared/types';
import { invoke } from '../../../lib/ipc';
import { Button, ICON_STROKE, Skeleton, cx } from '../../../ui/components';
import { GRANT_LABEL, accessibilityState, allGranted, microphoneState, type GrantState } from './permissions';
import { InlineError, StepFooter, StepHeader, useStepNav } from './step-frame';
import { useAsyncAction } from './use-async-action';
import { usePermissionStatus } from './use-permission-status';

type PermissionKind = 'microphone' | 'accessibility';

interface PermissionSpec {
  readonly kind: PermissionKind;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly why: string;
  readonly note?: string;
  readonly state: (status: PermissionStatus) => GrantState;
}

const PERMISSIONS: readonly PermissionSpec[] = [
  {
    kind: 'microphone',
    icon: Mic,
    title: 'Microphone',
    why: 'So Rivertide can hear you while you hold fn.',
    state: (status) => microphoneState(status.microphone),
  },
  {
    kind: 'accessibility',
    icon: Accessibility,
    title: 'Accessibility',
    why: 'So Rivertide can type into other apps and notice the fn key.',
    note: 'macOS may also ask for Input Monitoring. Allow that too, so the fn key works in every app.',
    state: (status) => accessibilityState(status.accessibility),
  },
];

const STATE_ICON: Readonly<Record<GrantState, LucideIcon>> = {
  granted: CircleCheck,
  'not-yet': CircleDashed,
  blocked: Ban,
};

function GrantStatus({ state }: { readonly state: GrantState | null }) {
  if (!state) return <Skeleton width={96} height={24} radius={999} />;
  const Icon = STATE_ICON[state];
  return (
    <span className={cx('onb-grant', `onb-grant--${state}`)}>
      <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
      {GRANT_LABEL[state]}
    </span>
  );
}

interface PermissionRowProps {
  readonly spec: PermissionSpec;
  readonly status: PermissionStatus | null;
  readonly onStatus: (status: PermissionStatus) => void;
}

function PermissionRow({ spec, status, onStatus }: PermissionRowProps) {
  const allow = useAsyncAction();
  const open = useAsyncAction();
  const [opened, setOpened] = useState(false);
  const state = status ? spec.state(status) : null;
  const Icon = spec.icon;

  const request = async () => {
    const next = await allow.run(() => invoke('permissions:request', { kind: spec.kind }), (detail) => `macOS didn’t show the request. ${detail}`);
    if (next) onStatus(next);
  };
  const openSettings = async () => {
    const done = await open.run(() => invoke('permissions:openSettings', { kind: spec.kind }), (detail) => `System Settings didn’t open. ${detail}`);
    if (done) setOpened(true);
  };

  return (
    <li className="onb-perm">
      <span className="onb-chip" aria-hidden>
        <Icon size={18} strokeWidth={ICON_STROKE} />
      </span>
      <div className="onb-perm__body">
        <div className="onb-perm__top">
          <h2 className="onb-perm__title">{spec.title}</h2>
          <span aria-live="polite">
            <span className="visually-hidden">{spec.title}: </span>
            <GrantStatus state={state} />
          </span>
        </div>
        <p className="onb-perm__why">{spec.why}</p>
        {spec.note ? <p className="onb-perm__note">{spec.note}</p> : null}
        {state && state !== 'granted' ? (
          <div className="onb-perm__actions">
            {state === 'not-yet' ? (
              <Button variant="ghost" loading={allow.pending} onClick={() => void request()}>
                Allow
              </Button>
            ) : null}
            <Button variant="quiet" icon={ExternalLink} loading={open.pending} onClick={() => void openSettings()}>
              Open System Settings
            </Button>
          </div>
        ) : null}
        {opened && state !== 'granted' ? (
          <p className="onb-perm__note" role="status">Turn on Rivertide in System Settings, then come back. This page updates by itself.</p>
        ) : null}
        {allow.error ? <InlineError>{allow.error}</InlineError> : null}
        {open.error ? <InlineError>{open.error}</InlineError> : null}
      </div>
    </li>
  );
}

export function PermissionsStep() {
  const { goNext } = useStepNav();
  const { status, error, receive } = usePermissionStatus();
  const ready = status !== null && allGranted(status);

  return (
    <>
      <StepHeader lede="Rivertide needs two macOS permissions to hear you and to type for you." />
      {error && !status ? <InlineError>{`Rivertide couldn’t check permissions. ${error} It will keep trying.`}</InlineError> : null}
      <ul className="onb-perms">
        {PERMISSIONS.map((spec) => (
          <PermissionRow key={spec.kind} spec={spec} status={status} onStatus={receive} />
        ))}
      </ul>
      <aside className="onb-tip" aria-label="Tip">
        <span className="onb-chip" aria-hidden>
          <Keyboard size={18} strokeWidth={ICON_STROKE} />
        </span>
        <p>
          In System Settings → Keyboard, set “Press fn key to” → “Do Nothing” so the fn (globe) key is free for Rivertide.
        </p>
      </aside>
      <StepFooter
        note={ready ? null : <p className="onb-foot__hint">You can do this later in Settings.</p>}
        primary={(
          <Button variant="accent" size="lg" iconEnd={ArrowRight} onClick={goNext}>
            Continue
          </Button>
        )}
      />
    </>
  );
}
