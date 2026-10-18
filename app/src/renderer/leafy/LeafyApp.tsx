import { useCallback, useEffect, useState } from 'react';
import { LeafySprite } from '@rivertide/leafy';
import type { LeafyCue } from '@shared/types';
import { errorMessage } from '../lib/ipc';
import { formatAccelerator } from '../lib/hooks/accelerator';
import { fireAndForget, reportError, safeInvoke } from '../lib/hooks/bridge';
import { useAgentRun } from '../lib/hooks/useAgentRun';
import { useApplyAppearance } from '../lib/hooks/useApplyAppearance';
import { useAudioLevel } from '../lib/hooks/useAudioLevel';
import { useLeafyCue, type ReceivedCue } from '../lib/hooks/useLeafyCue';
import { safePlatform } from '../lib/hooks/platform';
import { useReducedMotion } from '../lib/hooks/useReducedMotion';
import { useSettings } from '../lib/hooks/useSettings';
import { useVoiceSnapshot } from '../lib/hooks/useVoiceSnapshot';
import { isBusyPhase } from '../lib/hooks/voiceCopy';
import { greetingFor } from './bubble';
import { LEAFY_SCALE, leafyLayout, type Corner } from './layout';
import { SpeechBubble } from './SpeechBubble';
import { Toolbar, type MicState } from './Toolbar';
import { useLeafyDrag } from './useLeafyDrag';
import { useLeafyState, type Greeting } from './useLeafyState';
import { useLingering, usePointerRegions } from './usePointerRegions';

const TOOLBAR_LINGER_MS = 450;
const NOTICE_HOLD_MS = 7000;

function useViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/** Which screen edge Leafy lives on (asks main; re-asked after every drop and resize). */
function useCorner(viewportKey: string) {
  const [corner, setCorner] = useState<Corner>('right');
  const refresh = useCallback(() => {
    safeInvoke('leafy:position', undefined)
      .then((position) => setCorner(position.corner))
      .catch((error: unknown) => reportError('leafy:position', error));
  }, []);
  useEffect(refresh, [refresh, viewportKey]);
  return { corner, refresh };
}

/** "Hi {name}" once per launch, as soon as settings tell us the name. */
function useGreeting(name: string | null, tipShortcut: string | null): Greeting | null {
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  useEffect(() => {
    if (name === null || greeting) return;
    setGreeting({ ...greetingFor(name, tipShortcut), shownAt: Date.now() });
  }, [name, tipShortcut, greeting]);
  return greeting;
}

export function LeafyApp() {
  const settings = useSettings();
  useApplyAppearance(settings, { textScale: false });
  const reducedMotion = useReducedMotion(settings?.appearance.reduceMotion);
  const snapshot = useVoiceSnapshot();
  const run = useAgentRun('latest');
  const mainCue = useLeafyCue();
  const [notice, setNotice] = useState<ReceivedCue | null>(null);
  const viewport = useViewport();
  const { corner, refresh: refreshCorner } = useCorner(`${viewport.width}x${viewport.height}`);
  const platform = safePlatform();
  const commandShortcut = formatAccelerator(settings?.hotkeys.command ?? 'CommandOrControl+Shift+L', platform);
  const paletteShortcut = formatAccelerator(settings?.hotkeys.palette ?? 'CommandOrControl+Shift+Space', platform);
  const greeting = useGreeting(settings ? settings.profile.name : null, settings?.leafy.tips ? commandShortcut : null);

  const [dropSeq, setDropSeq] = useState(0);
  const [interactionAt, setInteractionAt] = useState(() => Date.now());
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const say = useCallback((message: string, mood: LeafyCue['mood'] = 'error') => {
    setNotice((prev) => ({ cue: { mood, say: message, holdMs: NOTICE_HOLD_MS }, receivedAt: Date.now(), seq: (prev?.seq ?? 0) - 1 }));
  }, []);
  const act = useCallback(
    (task: () => Promise<unknown>, scope: string) => {
      setInteractionAt(Date.now());
      task().catch((error: unknown) => {
        reportError(scope, error);
        say(errorMessage(error));
      });
    },
    [say],
  );

  const openPalette = useCallback(() => act(() => safeInvoke('window:open', { target: 'palette', mode: 'search' }), 'window:open'), [act]);
  const startVoice = useCallback(() => act(() => safeInvoke('voice:start', { mode: 'command', source: 'leafy' }), 'voice:start'), [act]);

  const { dragging, handlers: dragHandlers } = useLeafyDrag({
    onClick: openPalette,
    onDoubleClick: startVoice,
    onDrop: () => {
      setDropSeq((prev) => prev + 1);
      refreshCorner();
    },
  });

  const { hovered, handlers: regions, clear: clearRegion } = usePointerRegions(dragging || toolbarFocused);
  const hoveringLeafy = hovered.has('sprite') || hovered.has('toolbar');
  useEffect(() => {
    if (hoveringLeafy || dragging) setInteractionAt(Date.now());
  }, [hoveringLeafy, dragging]);

  const cue = [mainCue, notice].reduce<ReceivedCue | null>((best, c) => (c && (!best || c.receivedAt > best.receivedAt) ? c : best), null);
  const { mood, moodKey, onSettle, bubble } = useLeafyState({
    snapshot,
    run,
    cue,
    greeting,
    settings,
    drag: dragging ? 'dragging' : dropSeq > 0 ? 'dropped' : null,
    dropSeq,
    interactionAt,
    platform,
  });

  const listeningForCommand = snapshot.phase === 'listening' && snapshot.mode === 'command';
  const toolbarVisible = useLingering(hoveringLeafy, TOOLBAR_LINGER_MS) || toolbarFocused || listeningForCommand;
  const levelRef = useAudioLevel(snapshot.phase === 'listening' && toolbarVisible);
  const micState: MicState = snapshot.phase === 'listening' ? 'listening' : isBusyPhase(snapshot.phase) ? 'busy' : 'ready';

  const onMic = () => {
    if (micState === 'listening') act(() => safeInvoke('voice:stop', undefined), 'voice:stop');
    else if (micState === 'busy') act(() => safeInvoke('voice:cancel', undefined), 'voice:cancel');
    else startVoice();
  };

  const scale = LEAFY_SCALE[settings?.leafy.size ?? 'medium'];
  const layout = leafyLayout({ width: viewport.width, height: viewport.height, scale, corner });
  const pinnedBubble = bubble && bubble.key !== dismissedKey ? bubble : null;
  const bubbleShown = pinnedBubble !== null;
  useEffect(() => {
    if (!bubbleShown) clearRegion('bubble');
  }, [bubbleShown, clearRegion]);

  return (
    <main className="lf-stage" data-corner={corner} data-dragging={dragging}>
      <SpeechBubble
        content={pinnedBubble}
        box={layout.bubble}
        lifted={toolbarVisible}
        reducedMotion={reducedMotion}
        regionHandlers={regions.bubble}
        onDismiss={() => bubble && setDismissedKey(bubble.key)}
      />
      <Toolbar
        box={layout.toolbar}
        visible={toolbarVisible}
        micState={micState}
        levelRef={levelRef}
        reducedMotion={reducedMotion}
        commandShortcut={commandShortcut}
        paletteShortcut={paletteShortcut}
        regionHandlers={regions.toolbar}
        onFocusWithin={setToolbarFocused}
        onMic={onMic}
        onSearch={openPalette}
        onMore={() => act(() => safeInvoke('leafy:menu', undefined), 'leafy:menu')}
      />
      <div
        className="lf-sprite"
        role="button"
        tabIndex={0}
        aria-label="Leafy. Click to search or ask, double-click to talk, drag to move."
        data-dragging={dragging}
        style={{ left: layout.sprite.left, top: layout.sprite.top, width: layout.sprite.width, height: layout.sprite.height }}
        {...regions.sprite}
        {...dragHandlers}
        onContextMenu={(event) => {
          event.preventDefault();
          fireAndForget('leafy:menu', undefined);
        }}
      >
        <span className="lf-ground" aria-hidden />
        <LeafySprite key={moodKey} mood={mood} scale={scale} decorative reducedMotion={reducedMotion} onSettle={onSettle} />
      </div>
    </main>
  );
}
