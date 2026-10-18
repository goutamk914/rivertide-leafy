import { ExternalLink } from 'lucide-react';
import type { AppInfo } from '@shared/types';
import { invoke } from '../../../../lib/ipc';
import { Badge, Button, Skeleton } from '../../../../ui/components';
import { useIpcQuery } from '../../../hooks/useIpc';
import { PageError } from '../../../shell/Page';
import { openExternal } from '../parts/external';
import { SectionFrame, SettingGroup } from '../parts/layout';

export const CODE_THE_CURE_URL = 'https://codethecure.org';
export const PRIVACY_NOTE_URL = 'https://codethecure.github.io/privacy/';

const PLATFORM_NAMES: Readonly<Record<AppInfo['platform'], string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

const DETAIL_ROWS = 4;

function Details({ info }: { readonly info: AppInfo }) {
  const rows: readonly [string, string][] = [
    ['Version', info.version],
    ['System', `${PLATFORM_NAMES[info.platform]} (${info.arch})`],
    ['Electron', info.electron],
    ['Data folder', info.userDataPath],
  ];
  return (
    <dl className="settings-about">
      {rows.map(([term, value]) => (
        <div key={term} className="settings-about__row">
          <dt>{term}</dt>
          <dd className={term === 'Data folder' ? 'mono' : 'tabular'}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailsSkeleton() {
  return (
    <div role="status" aria-label="Loading app details" className="settings-about">
      {Array.from({ length: DETAIL_ROWS }, (_, i) => (
        <Skeleton key={i} height={20} width={i === DETAIL_ROWS - 1 ? '70%' : '45%'} />
      ))}
    </div>
  );
}

export function AboutSection() {
  const info = useIpcQuery(() => invoke('app:info', undefined), []);
  const renderDetails = () => {
    if (info.loading) return <DetailsSkeleton />;
    if (info.error || !info.data) {
      return <PageError message={`Rivertide couldn’t read its version details. ${info.error ?? ''}`.trim()} onRetry={info.reload} />;
    }
    return <Details info={info.data} />;
  };

  return (
    <SectionFrame title="About">
      <SettingGroup
        title="Rivertide"
        actions={info.data?.isDev ? <Badge tone="warn">Development build</Badge> : null}
      >
        {renderDetails()}
      </SettingGroup>
      <SettingGroup title="Who makes it">
        <p>Rivertide is made by Code the Cure.</p>
        <div className="settings-actions">
          <Button variant="quiet" iconEnd={ExternalLink} onClick={() => void openExternal(CODE_THE_CURE_URL)}>
            codethecure.org
          </Button>
          <Button variant="quiet" iconEnd={ExternalLink} onClick={() => void openExternal(PRIVACY_NOTE_URL)}>
            Privacy note
          </Button>
        </div>
      </SettingGroup>
    </SectionFrame>
  );
}
