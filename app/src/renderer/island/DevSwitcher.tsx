import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AudioLevel, VoiceSnapshot } from '@shared/types';
import { isElectron } from '../lib/ipc';
import { DEV_SCENES, DEV_SNAPSHOTS, parseDevScene, syntheticLevel, type DevSceneName } from './devScenes';

export interface DevScene {
  readonly name: DevSceneName;
  readonly snapshot: VoiceSnapshot;
  readonly levelRef: RefObject<AudioLevel>;
  readonly select: (name: DevSceneName) => void;
}

/** In a plain browser with `?scene=…`, drives the island from fixtures and a fake mic. */
export function useDevScene(): DevScene | null {
  const [name, setName] = useState<DevSceneName | null>(() =>
    typeof window !== 'undefined' && !isElectron() ? parseDevScene(window.location.search) : null,
  );
  const levelRef = useRef<AudioLevel>({ level: 0, bands: [] });

  useEffect(() => {
    if (!name) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      levelRef.current = { level: syntheticLevel(now - start), bands: [] };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [name]);

  if (!name) return null;
  const select = (next: DevSceneName) => {
    const url = new URL(window.location.href);
    url.searchParams.set('scene', next);
    window.history.replaceState(null, '', url);
    setName(next);
  };
  return { name, snapshot: DEV_SNAPSHOTS[name], levelRef, select };
}

/** Dev-only strip of buttons under the island for the integrator's screenshots. */
export function DevSwitcher({ scene }: { readonly scene: DevScene }) {
  return (
    <nav className="il-dev" aria-label="Island scenes (development)">
      {DEV_SCENES.map((name) => (
        <button key={name} type="button" data-active={name === scene.name} onClick={() => scene.select(name)}>
          {name}
        </button>
      ))}
    </nav>
  );
}
