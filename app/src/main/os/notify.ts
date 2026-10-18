/** Native desktop notifications (Electron Notification); silently skipped where unsupported. */
import { Notification } from 'electron';
import type { Logger } from '../services';

export type Notify = (title: string, body: string) => void;

export function createNotifier(logger: Logger): Notify {
  const log = logger.child('notify');
  return (title, body) => {
    if (!Notification.isSupported()) {
      log.debug('notifications are not supported here', { title });
      return;
    }
    try {
      new Notification({ title, body, silent: false }).show();
    } catch (error) {
      log.warn('could not show a notification', { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
