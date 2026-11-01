import type { Route } from '../../lib/router';
import { ICON_STROKE, Kbd } from '../../ui/components';
import { usePresentation } from '../app-context';
import rivertideLogo from '../../assets/onboarding/rivertide-logo.png';
import { visibleNav } from './nav';

export interface SidebarProps {
  readonly route: Route;
  readonly useFn: boolean;
}

export function Sidebar({ route, useFn }: SidebarProps) {
  const { calm } = usePresentation();
  return (
    <aside className="sidebar">
      <div className="sidebar__drag drag-region" />
      <div className="sidebar__brand">
        <img src={rivertideLogo} alt="" className="sidebar__logo" />
        <div className="sidebar__brand-text">
          <span className="sidebar__name">Rivertide</span>
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
