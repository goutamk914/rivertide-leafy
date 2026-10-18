/**
 * Media keys: the native helper on macOS (real hardware key events, works with any player),
 * PowerShell virtual keys on Windows, playerctl/pactl on Linux.
 */
import type { MediaKey } from './helper';
import type { ExecFn } from './exec';
import { notAvailable, OsActionError } from './errors';

export type { MediaKey };

export interface MediaControls {
  press(key: MediaKey): Promise<void>;
}

export interface MediaDeps {
  readonly platform: NodeJS.Platform;
  readonly exec: ExecFn;
  readonly helper: { isReady(): boolean; mediaKey(key: MediaKey): Promise<void> } | null;
}

const WINDOWS_KEY_CODES: Readonly<Record<MediaKey, number>> = {
  playpause: 179, next: 176, previous: 177, mute: 173, volumeDown: 174, volumeUp: 175,
};
const LINUX_COMMANDS: Readonly<Record<MediaKey, readonly [string, readonly string[]]>> = {
  playpause: ['playerctl', ['play-pause']],
  next: ['playerctl', ['next']],
  previous: ['playerctl', ['previous']],
  mute: ['pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']],
  volumeUp: ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '+10%']],
  volumeDown: ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '-10%']],
};

export function createMediaControls(deps: MediaDeps): MediaControls {
  async function press(key: MediaKey): Promise<void> {
    if (deps.platform === 'darwin') {
      if (!deps.helper?.isReady()) {
        throw new OsActionError('Media keys need Rivertide’s keyboard helper. Turn on Accessibility for Rivertide in System Settings.');
      }
      await deps.helper.mediaKey(key);
      return;
    }
    if (deps.platform === 'win32') {
      const script = `(New-Object -ComObject WScript.Shell).SendKeys([char]${WINDOWS_KEY_CODES[key]})`;
      const result = await deps.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
      if (!result.ok) throw notAvailable('Media control');
      return;
    }
    const [command, args] = LINUX_COMMANDS[key];
    const result = await deps.exec(command, args);
    if (!result.ok) throw notAvailable('Media control');
  }
  return { press };
}
