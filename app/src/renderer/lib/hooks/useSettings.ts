import { useEffect, useState } from 'react';
import type { Settings } from '@shared/settings';
import { reportError, safeInvoke, safeOn } from './bridge';

/**
 * Current settings, or `null` until main has answered. Follows `settings:changed` pushes.
 * Read-only: change settings with `invoke('settings:update', { patch })`.
 */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let alive = true;
    let pushed = false;
    const off = safeOn('settings:changed', (next) => {
      pushed = true;
      setSettings(next);
    });
    safeInvoke('settings:get', undefined)
      .then((initial) => {
        if (alive && !pushed) setSettings(initial);
      })
      .catch((error: unknown) => reportError('settings:get', error));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return settings;
}
