/**
 * Settings for the dashboard window: loaded once, kept in sync with `settings:changed`, and saved
 * optimistically (the UI updates immediately; on failure it rolls back and says what to do).
 */
import { create } from 'zustand';
import { applySettingsPatch, type Settings, type SettingsPatch } from '@shared/settings';
import { errorMessage, invoke } from '../../lib/ipc';
import { toast } from '../../ui/components';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SettingsState {
  readonly settings: Settings | null;
  readonly loadError: string | null;
  readonly saveState: SaveState;
  readonly saveError: string | null;
  /** Bumps on every save so "Saved" indicators can re-announce. */
  readonly saveCount: number;
  readonly load: () => Promise<void>;
  readonly receive: (settings: Settings) => void;
  /** Applies `patch` now and persists it. Resolves false when the value was invalid or the save failed. */
  readonly update: (patch: SettingsPatch) => Promise<boolean>;
}

let pending = 0;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loadError: null,
  saveState: 'idle',
  saveError: null,
  saveCount: 0,
  load: async () => {
    try {
      const settings = await invoke('settings:get', undefined);
      set({ settings, loadError: null });
    } catch (error) {
      set({ loadError: `Rivertide couldn’t load your settings. ${errorMessage(error)}` });
    }
  },
  receive: (settings) => {
    // Ignore echoes while our own saves are in flight; the save result is authoritative.
    if (pending === 0) set({ settings });
  },
  update: async (patch) => {
    const current = get().settings;
    if (!current) return false;
    let optimistic: Settings;
    try {
      optimistic = applySettingsPatch(current, patch);
    } catch {
      set({ saveState: 'error', saveError: 'That value isn’t allowed. Check the field and try again.' });
      return false;
    }
    pending += 1;
    set({ settings: optimistic, saveState: 'saving', saveError: null });
    try {
      const saved = await invoke('settings:update', { patch: patch as Record<string, unknown> });
      pending -= 1;
      set((state) => ({ settings: pending === 0 ? saved : state.settings, saveState: 'saved', saveCount: state.saveCount + 1 }));
      return true;
    } catch (error) {
      pending -= 1;
      const message = `Your change wasn’t saved. ${errorMessage(error)}`;
      set({ saveState: 'error', saveError: message });
      toast.error(message);
      // Roll back to what main actually has (other saves may have landed meanwhile), not a stale snapshot.
      const truth = await invoke('settings:get', undefined).catch(() => current);
      if (pending === 0) set({ settings: truth });
      return false;
    }
  },
}));

/** Settings once loaded. Components under the App gate can rely on them being present. */
export function useSettings(): Settings {
  const settings = useSettingsStore((s) => s.settings);
  if (!settings) throw new Error('useSettings() used before settings loaded.');
  return settings;
}

export function useUpdateSettings(): SettingsState['update'] {
  return useSettingsStore((s) => s.update);
}
