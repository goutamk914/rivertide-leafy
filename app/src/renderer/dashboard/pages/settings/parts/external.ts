import { errorMessage, invoke, platform } from '../../../../lib/ipc';
import { toast } from '../../../../ui/components';
import type { Platform } from '../model/accelerator';

/** Opens a web page in the person's browser (main checks it is http(s)); failures become a toast. */
export async function openExternal(url: string): Promise<void> {
  try {
    await invoke('system:openExternal', { url });
  } catch (error) {
    toast.error(`Rivertide couldn’t open that page. ${errorMessage(error)}`);
  }
}

/** The OS this window runs on; macOS when the bridge can't say (key labels default to Mac). */
export function currentPlatform(): Platform {
  try {
    return platform();
  } catch {
    return 'darwin';
  }
}
