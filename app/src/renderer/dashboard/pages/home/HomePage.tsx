import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';
import { dayKey, greeting } from '../../../lib/format';
import { invoke } from '../../../lib/ipc';
import { Card, ICON_STROKE, Keys } from '../../../ui/components';
import { usePresentation } from '../../app-context';
import { useIpcQuery, useNow } from '../../hooks/useIpc';
import { moodForPhase, phaseLabel, useVoiceSnapshot } from '../../hooks/useVoice';
import { Page, type PageComponentProps } from '../../shell/Page';
import { useSettings } from '../../state/settings-store';
import { FogCard, RecentActivity, TodayCard, UpcomingReminders } from './HomeCards';
import { QuickActions } from './QuickActions';
import './home.css';

const RECENT_COUNT = 5;
const FOG_DAYS = 14;

interface Tip {
  readonly text: string;
  readonly keys?: string;
}

export const TIPS: readonly Tip[] = [
  { text: 'Hold fn, speak, and let go. Rivertide writes it where your cursor is.' },
  { text: 'Press fn twice quickly to keep listening hands-free. Press it again when you’re done.' },
  { text: 'Hold ctrl and fn to ask a question. The answer is pasted for you.' },
  { text: 'Hold shift and fn to ask Leafy to do something, like set a timer.' },
  { text: 'Open Leafy’s palette to search your notes, apps and files.', keys: 'palette' },
  { text: 'Press Esc any time to cancel what Rivertide is doing.' },
  { text: 'Add names and medicines Rivertide mishears in Knowledge → Dictionary.' },
];

/** Same tip all day, a different one tomorrow. */
export function tipForDay(date: Date): Tip {
  const days = Math.floor(Date.parse(`${dayKey(date)}T00:00:00Z`) / 86_400_000);
  return TIPS[days % TIPS.length] as Tip;
}

function Hero({ compact }: { readonly compact: boolean }) {
  const voice = useVoiceSnapshot();
  const { reduceMotion } = usePresentation();
  const [restMood, setRestMood] = useState<LeafyMood>('greeting');
  const phase = voice?.phase ?? 'idle';
  const heard = phase !== 'idle' && voice?.transcript ? voice.transcript : null;
  return (
    <Card className="home__hero">
      <LeafySprite
        mood={phase === 'idle' ? restMood : moodForPhase(phase)}
        scale={4}
        reducedMotion={reduceMotion}
        label={`Leafy: ${phaseLabel(phase)}`}
        onSettle={phase === 'idle' ? setRestMood : undefined}
      />
      <div className="home__hero-text">
        <p className="home__hero-status" role="status">{phase === 'idle' ? 'What would you like to do?' : phaseLabel(phase)}</p>
        {heard ? <p className="home__hero-heard">“{heard}”</p> : <p className="home__hero-heard">Speak naturally. Rivertide writes clearly.</p>}
        <QuickActions compact={compact} />
      </div>
    </Card>
  );
}

export function HomePage(_props: PageComponentProps) {
  const settings = useSettings();
  const { calm } = usePresentation();
  const now = useNow();
  const usage = useIpcQuery(() => invoke('insights:usage', { days: 1 }), [], ['history']);
  const dynamics = useIpcQuery(() => invoke('insights:dynamics', { days: FOG_DAYS }), [], ['dynamics']);
  const recent = useIpcQuery(() => invoke('history:list', { limit: RECENT_COUNT }), [], ['history']);
  const reminders = useIpcQuery(() => invoke('reminders:list', undefined), [], ['reminders']);
  const name = settings.profile.name.trim();
  const tip = tipForDay(now);

  return (
    <Page title={`${greeting(now.getHours())}${name ? `, ${name}` : ''}`}>
      <div className="home">
        <Hero compact={calm} />
        {calm ? null : (
          <>
            <TodayCard usage={usage} />
            <FogCard dynamics={dynamics} />
            <RecentActivity items={recent.data} error={recent.error} reload={recent.reload} now={now} />
          </>
        )}
        <UpcomingReminders items={reminders.data} error={reminders.error} reload={reminders.reload} now={now} />
        {calm ? null : (
          <p className="home__tip">
            <Lightbulb size={18} strokeWidth={ICON_STROKE} aria-hidden />
            <span>
              <span className="visually-hidden">Tip: </span>
              {tip.text}
            </span>
            {tip.keys === 'palette' ? <Keys keys={settings.hotkeys.palette} /> : null}
          </p>
        )}
      </div>
    </Page>
  );
}
