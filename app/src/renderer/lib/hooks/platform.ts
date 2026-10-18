import { platform } from '../ipc';
import type { Platform } from './accelerator';

/** The OS the bridge reports, defaulting to macOS when no bridge is installed yet. */
export function safePlatform(): Platform {
  try {
    return platform();
  } catch {
    return 'darwin';
  }
}
