import { useEffect, useRef, useState } from 'react';
import { formatAccelerator } from '../lib/hooks/accelerator';
import { reportError, safeInvoke } from '../lib/hooks/bridge';
import { safePlatform } from '../lib/hooks/platform';
import { useApplyAppearance } from '../lib/hooks/useApplyAppearance';
import { useReducedMotion } from '../lib/hooks/useReducedMotion';
import { useSettings } from '../lib/hooks/useSettings';
import { AskThread, VoiceView } from './AskThread';
import { EmptyState, shortcutHints } from './EmptyState';
import { PaletteFooter } from './PaletteFooter';
import { PaletteHeader } from './PaletteHeader';
import { paletteMood } from './paletteMood';
import { optionId, ResultsList } from './ResultsList';
import { usePalette, type PaletteController } from './usePalette';
import { usePaletteResize } from './usePaletteResize';

/** True while the quick-pick modifier (⌘ on mac, Ctrl elsewhere) is held. */
function useModifierHeld(key: 'Meta' | 'Control'): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => setHeld(key === 'Meta' ? event.metaKey : event.ctrlKey);
    const up = (event: KeyboardEvent) => setHeld(key === 'Meta' ? event.metaKey : event.ctrlKey);
    const reset = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [key]);
  return held;
}

function openChat(): void {
  safeInvoke('window:open', { target: 'dashboard', route: '/chat' })
    .then(() => safeInvoke('palette:hide', undefined))
    .catch((error: unknown) => reportError('window:open', error));
}

function PaletteBody({ c, name, hints, quickKeys, isMac }: { readonly c: PaletteController; readonly name: string; readonly hints: ReturnType<typeof shortcutHints>; readonly quickKeys: boolean; readonly isMac: boolean }) {
  if (c.view === 'ask') return <AskThread turns={c.agent.turns} book={c.book} pending={c.pending} onAnswer={c.answer} />;
  if (c.view === 'voice') return <VoiceView snapshot={c.voiceSnapshot} run={c.agent.voiceRun} pending={c.pending} onAnswer={c.answer} />;
  if (!c.query.trim()) return <EmptyState name={name} hints={hints} onSuggest={c.ask} />;
  return (
    <ResultsList
      grouped={c.grouped}
      activeIndex={c.activeIndex}
      showQuickKeys={quickKeys}
      quickModifier={isMac ? '⌘' : 'Ctrl+'}
      onHover={c.setActive}
      onExecute={c.execute}
    />
  );
}

/** Rivertide's Spotlight: search everything, run commands, or ask Leafy — by typing or by voice. */
export function PaletteApp() {
  const settings = useSettings();
  useApplyAppearance(settings);
  const reducedMotion = useReducedMotion(settings?.appearance.reduceMotion);
  const platform = safePlatform();
  const isMac = platform === 'darwin';
  const c = usePalette(isMac);
  const cardRef = useRef<HTMLDivElement>(null);
  usePaletteResize(cardRef);
  const quickKeys = useModifierHeld(isMac ? 'Meta' : 'Control');

  const listening = c.snapshot.phase === 'listening' && c.view === 'voice';
  const hearing = c.view === 'voice' && (c.snapshot.phase === 'listening' || c.snapshot.phase === 'transcribing');
  const showResults = c.view === 'search' && c.query.trim() !== '';
  const busy = c.view === 'ask' ? c.agent.askBusy : c.agent.voiceBusy;
  const currentTurn = c.agent.turns[c.agent.turns.length - 1];
  const mood = paletteMood({
    view: c.view,
    query: c.query,
    phase: c.snapshot.phase,
    run: c.view === 'voice' ? c.agent.voiceRun : c.agent.currentRun,
    waiting: Boolean(currentTurn && !currentTurn.runId && !currentTurn.error),
  });
  const greet = c.view === 'search' && !c.query && mood === 'idle';

  return (
    <div className="pl-shell" data-view={c.view}>
      <div className="pl-card" ref={cardRef}>
        <PaletteHeader
          inputRef={c.inputRef}
          view={c.view}
          value={hearing ? c.snapshot.transcript : c.query}
          listening={listening}
          readOnly={hearing}
          mood={greet ? 'greeting' : mood}
          moodKey={String(c.openCount)}
          activeDescendant={showResults && c.grouped.flat.length ? optionId(c.activeIndex) : undefined}
          expanded={showResults}
          reducedMotion={reducedMotion}
          commandShortcut={formatAccelerator(settings?.hotkeys.command ?? 'CommandOrControl+Shift+L', platform)}
          onChange={c.onQueryChange}
          onKeyDown={c.onKeyDown}
          onMic={c.toggleMic}
        />
        <div className="pl-body" data-reserve={showResults} key={c.view}>
          <PaletteBody c={c} name={settings?.profile.name ?? ''} hints={shortcutHints(settings, platform)} quickKeys={quickKeys} isMac={isMac} />
        </div>
        {c.view !== 'search' || showResults || c.notice ? (
          <PaletteFooter
            view={c.view}
            active={showResults ? c.grouped.flat[c.activeIndex] ?? null : null}
            hasQuery={c.query.trim() !== ''}
            busy={busy}
            notice={c.notice}
            onOpenChat={openChat}
          />
        ) : null}
      </div>
    </div>
  );
}
