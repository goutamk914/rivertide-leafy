import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionStatus } from '@shared/types';
import { errorMessage, invoke } from '../../../lib/ipc';
import { PERMISSION_POLL_MS } from './permissions';

export interface PermissionStatusState {
  readonly status: PermissionStatus | null;
  readonly error: string | null;
  /** Accepts a fresher status (e.g. the result of `permissions:request`). */
  readonly receive: (status: PermissionStatus) => void;
}

/**
 * Live permission status: read now, then every `intervalMs` for as long as the caller is mounted.
 * The permissions step is the only caller, so polling stops the moment the person leaves it.
 */
export function usePermissionStatus(intervalMs = PERMISSION_POLL_MS): PermissionStatusState {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every poll and every `receive`, so a slow poll can't overwrite a fresher status.
  const latest = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      latest.current += 1;
      const ticket = latest.current;
      invoke('permissions:status', undefined)
        .then((next) => {
          if (!alive || ticket !== latest.current) return;
          setStatus(next);
          setError(null);
        })
        .catch((err: unknown) => {
          if (alive) setError(errorMessage(err));
        });
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  const receive = useCallback((next: PermissionStatus) => {
    latest.current += 1;
    setStatus(next);
  }, []);

  return { status, error, receive };
}
