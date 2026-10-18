/** The Settings sub-pages, their routes, and which ones calm mode keeps in the list. */

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', calm: true },
  { id: 'voice', label: 'Voice', calm: true },
  { id: 'shortcuts', label: 'Shortcuts', calm: false },
  { id: 'ai', label: 'AI', calm: false },
  { id: 'leafy', label: 'Leafy', calm: false },
  { id: 'leafy-permissions', label: 'Leafy’s permissions', calm: false },
  { id: 'privacy', label: 'Privacy & data', calm: true },
  { id: 'about', label: 'About', calm: false },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type SettingsSectionId = SettingsSection['id'];

export const DEFAULT_SECTION: SettingsSectionId = 'general';

const isSectionId = (value: string): value is SettingsSectionId => SETTINGS_SECTIONS.some((s) => s.id === value);

/** `route.section` → a known section; missing or unknown falls back to General. */
export function resolveSection(section: string | null): SettingsSectionId {
  return section && isSectionId(section) ? section : DEFAULT_SECTION;
}

/**
 * Calm mode lists only General, Voice and Privacy. The open section stays listed so the
 * reader can see where they are (other sections remain reachable by link).
 */
export function visibleSections(calm: boolean, active: SettingsSectionId): readonly SettingsSection[] {
  return calm ? SETTINGS_SECTIONS.filter((s) => s.calm || s.id === active) : SETTINGS_SECTIONS;
}

export function sectionHref(id: SettingsSectionId): string {
  return `#/settings/${id}`;
}
