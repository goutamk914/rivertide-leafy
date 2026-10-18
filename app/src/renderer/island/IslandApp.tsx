import { useCallback, useEffect, useMemo, useState } from 'react';
import { DynamicIsland } from '@rivertide/island';
import { activeStep } from '../lib/hooks/agentRun';
import { fireAndForget, reportError, safeInvoke } from '../lib/hooks/bridge';
import { safePlatform } from '../lib/hooks/platform';
import { useAgentRun } from '../lib/hooks/useAgentRun';
import { useApplyAppearance } from '../lib/hooks/useApplyAppearance';
import { useAudioLevel } from '../lib/hooks/useAudioLevel';
import { useReducedMotion } from '../lib/hooks/useReducedMotion';
import { useSettings } from '../lib/hooks/useSettings';
import { useVoiceSnapshot } from '../lib/hooks/useVoiceSnapshot';
import { DevSwitcher, useDevScene } from './DevSwitcher';
import { renderScene, type IslandActions } from './IslandScenes';
import { buildIslandSpec, ISLAND_SIZES } from './sceneSpec';

/**
 * The Dynamic Island window: follows the voice session and agent, and shows one calm live
 * activity at a time. Click-through everywhere except over the capsule; never takes focus.
 */
export function IslandApp() {
  const settings = useSettings();
  useApplyAppearance(settings, { theme: false, textScale: false });
  const reducedMotion = useReducedMotion(settings?.appearance.reduceMotion);
  const dev = useDevScene();
  const live = useVoiceSnapshot();
  const snapshot = dev?.snapshot ?? live;
  const run = useAgentRun('latest');
  const [hovered, setHovered] = useState(false);
  const liveLevel = useAudioLevel(!dev && snapshot.phase === 'listening');
  const levelRef = dev?.levelRef ?? liveLevel;

  const spec = buildIslandSpec({ snapshot, tool: activeStep(run)?.tool ?? null, hovered, platform: safePlatform() });
  const visible = spec !== null;

  const setPointer = useCallback((interactive: boolean) => {
    setHovered(interactive);
    fireAndForget('island:pointer', { interactive });
  }, []);

  // Nothing to click once the island rests: hand the pointer back to the desktop.
  useEffect(() => {
    if (!visible) setPointer(false);
  }, [visible, setPointer]);

  const { mode, source } = snapshot;
  const actions = useMemo<IslandActions>(
    () => ({
      cancel: () => fireAndForget('voice:cancel', undefined),
      dismiss: () => fireAndForget('voice:cancel', undefined),
      confirm: (confirmation, approved) =>
        safeInvoke('agent:confirm', { runId: confirmation.runId, callId: confirmation.callId, approved }).then(
          () => undefined,
          (error: unknown) => {
            reportError('agent:confirm', error);
            throw error;
          },
        ),
      retry: () => fireAndForget('voice:start', { mode: mode ?? 'command', source: source ?? 'hotkey' }),
      openSettings: () => fireAndForget('window:open', { target: 'dashboard', route: '/settings' }),
    }),
    [mode, source],
  );

  const scene = spec ? renderScene(spec, { levelRef, reducedMotion, actions }) : null;

  return (
    <main className="il-stage" data-dev={dev ? 'true' : undefined}>
      <div className="il-wrap" data-visible={visible}>
        <DynamicIsland
          scene={scene}
          sizes={ISLAND_SIZES}
          reducedMotion={reducedMotion}
          onPointerEnter={() => setPointer(true)}
          onPointerLeave={() => setPointer(false)}
          aria-label="Rivertide activity"
          className="il-island"
        />
      </div>
      {dev ? <DevSwitcher scene={dev} /> : null}
    </main>
  );
}
