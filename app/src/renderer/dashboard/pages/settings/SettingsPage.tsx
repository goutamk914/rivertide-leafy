import type { ComponentType } from 'react';
import { Info, Keyboard, Lock, Mic, ShieldCheck, SlidersHorizontal, Sparkles, Sprout, type LucideIcon } from 'lucide-react';
import { ICON_STROKE } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { Page, type PageComponentProps } from '../../shell/Page';
import { resolveSection, sectionHref, visibleSections, type SettingsSectionId } from './model/sections';
import { SavedIndicator } from './parts/SavedIndicator';
import { AboutSection } from './sections/AboutSection';
import { AiSection } from './sections/AiSection';
import { GeneralSection } from './sections/GeneralSection';
import { LeafySection } from './sections/LeafySection';
import { PermissionsSection } from './sections/PermissionsSection';
import { PrivacySection } from './sections/PrivacySection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { VoiceSection } from './sections/VoiceSection';
import './settings.css';
import './settings-sections.css';

const SECTION_VIEWS: Readonly<Record<SettingsSectionId, ComponentType>> = {
  general: GeneralSection,
  voice: VoiceSection,
  shortcuts: ShortcutsSection,
  ai: AiSection,
  leafy: LeafySection,
  'leafy-permissions': PermissionsSection,
  privacy: PrivacySection,
  about: AboutSection,
};

const SECTION_ICONS: Readonly<Record<SettingsSectionId, LucideIcon>> = {
  general: SlidersHorizontal,
  voice: Mic,
  shortcuts: Keyboard,
  ai: Sparkles,
  leafy: Sprout,
  'leafy-permissions': ShieldCheck,
  privacy: Lock,
  about: Info,
};

function SettingsNav({ active, calm }: { readonly active: SettingsSectionId; readonly calm: boolean }) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <ul className="settings-nav__list">
        {visibleSections(calm, active).map(({ id, label }) => {
          const Icon = SECTION_ICONS[id];
          return (
            <li key={id}>
              <a className="settings-nav__link" href={sectionHref(id)} aria-current={id === active ? 'page' : undefined}>
                <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Settings: a sub-nav on the left, one section on the right. Every change saves straight away. */
export function SettingsPage({ route }: PageComponentProps) {
  const calm = useCalm();
  const active = resolveSection(route.section);
  const Section = SECTION_VIEWS[active];
  return (
    <Page title="Settings" actions={<SavedIndicator />}>
      <div className="settings-layout">
        <SettingsNav active={active} calm={calm} />
        <div className="settings-content">
          <Section key={active} />
        </div>
      </div>
    </Page>
  );
}
