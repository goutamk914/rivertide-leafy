import { LeafySprite } from '@rivertide/leafy';
import type { VoiceSnapshot } from '@shared/types';
import type { Route } from '../../lib/router';
import { ICON_STROKE, Kbd } from '../../ui/components';
import { usePresentation } from '../app-context';
import { moodForPhase, phaseLabel } from '../hooks/useVoice';
import { visibleNav } from './nav';

export interface SidebarProps {
  readonly route: Route;
  readonly voice: VoiceSnapshot | null;
  readonly useFn: boolean;
}

export function Sidebar({ route, voice, useFn }: SidebarProps) {
  const { calm, reduceMotion } = usePresentation();
  const phase = voice?.phase ?? 'idle';
  const status = phase === 'idle' ? 'Here when you need me' : phaseLabel(phase);
  return (
    <aside className="sidebar">
      <div className="sidebar__drag drag-region" />
      <div className="sidebar__brand">
        <LeafySprite mood={moodForPhase(phase)} scale={2} reducedMotion={reduceMotion} decorative />
        <div className="sidebar__brand-text">
          <span className="sidebar__name">Rivertide</span>
          <span className="sidebar__status" aria-live="polite">{status}</span>
        </div>
      </div>
      <nav aria-label="Main">
        <ul className="sidebar__nav">
          {visibleNav(calm).map(({ name, label, path, icon: Icon }) => (
            <li key={name}>
              <a className="nav-link" href={`#${path}`} aria-current={route.name === name ? 'page' : undefined}>
                <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="sidebar__hint">
        {useFn ? (
          <>
            Hold <Kbd>fn</Kbd> to talk
          </>
        ) : (
          'Use your dictation shortcut to talk'
        )}
      </p>
    </aside>
  );
}
