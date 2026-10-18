import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PendingConfirmation, SearchResult, VoiceSnapshot } from '@shared/types';
import { errorMessage } from '../lib/ipc';
import { reportError, safeInvoke, safeOn } from '../lib/hooks/bridge';
import { useRunBook } from '../lib/hooks/useAgentRun';
import { useVoiceSnapshot } from '../lib/hooks/useVoiceSnapshot';
import {
  clampActive, commandForKey, confirmKey, handlesCommand, moveActive, resolveEscape,
  type EscapeAction, type PaletteCommand, type PaletteView,
} from './navigation';
import { askIndex, groupResults, LOCAL_ASK_ID } from './sections';
import { usePaletteAgent } from './usePaletteAgent';
import { usePaletteSearch } from './usePaletteSearch';

const FALLBACK_FAILURE = 'That didn’t work. Try again, or ask Leafy.';

/** A result pick waiting for the search to catch up with what was typed. */
interface QueuedPick {
  readonly index: number;
  readonly alt: boolean;
}

/**
 * The palette's controller: input, search results, keyboard, Ask thread and voice capture.
 * Components stay presentational; everything that talks to main goes through here.
 */
export function usePalette(isMac: boolean) {
  const snapshot = useVoiceSnapshot();
  const book = useRunBook();
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<PaletteView>('search');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [queued, setQueued] = useState<QueuedPick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [lastVoice, setLastVoice] = useState<VoiceSnapshot | null>(null);

  const agent = usePaletteAgent(book, snapshot, setNotice);
  const { reset: resetAgent, startVoice: listen, ask: askAgent, answer: answerAgent } = agent;
  const search = usePaletteSearch(query, view === 'search');
  const grouped = useMemo(() => groupResults(search.results, query), [search.results, query]);
  const activeIndex = clampActive(active, grouped.flat.length);
  // Results on screen belong to what is typed now (not the previous keystroke).
  const fresh = query.trim() !== '' && !search.loading && search.query === query.trim();

  const focusInput = useCallback((select: boolean) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (select) inputRef.current?.select();
    });
  }, []);

  const resetState = useCallback(
    (initialQuery: string) => {
      resetAgent();
      setView('search');
      setQuery(initialQuery);
      setActive(0);
      setQueued(null);
      setNotice(null);
      setLastVoice(null);
    },
    [resetAgent],
  );

  const backToSearch = useCallback(() => {
    resetState('');
    focusInput(false);
  }, [resetState, focusInput]);

  // A new set of results starts at the top.
  useEffect(() => setActive(0), [search.query]);

  // The voice view keeps showing the finished session after main returns to idle.
  useEffect(() => {
    if (view === 'voice' && snapshot.phase !== 'idle') setLastVoice(snapshot);
  }, [view, snapshot]);
  const voiceSnapshot = snapshot.phase === 'idle' && lastVoice ? lastVoice : snapshot;

  const startVoice = useCallback(() => {
    setLastVoice(null);
    setView('voice');
    setQuery('');
    setNotice(null);
    listen();
    focusInput(false);
  }, [listen, focusInput]);

  const ask = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setView('ask');
      setQuery('');
      setNotice(null);
      askAgent(text);
      focusInput(false);
    },
    [askAgent, focusInput],
  );

  const answer = useCallback(
    (confirmation: PendingConfirmation, approved: boolean) => {
      answerAgent(confirmation, approved);
      focusInput(false);
    },
    [answerAgent, focusInput],
  );

  const execute = useCallback(
    (result: SearchResult, alt: boolean) => {
      if (result.kind === 'ask' || result.id === LOCAL_ASK_ID) {
        ask(query);
        return;
      }
      safeInvoke('palette:execute', { id: result.id, alt })
        .then((outcome) => setNotice(outcome.ok ? outcome.message : outcome.message ?? FALLBACK_FAILURE))
        .catch((error: unknown) => {
          reportError('palette:execute', error);
          setNotice(errorMessage(error));
        });
      focusInput(false);
    },
    [ask, query, focusInput],
  );

  // Enter pressed before the results caught up: run it as soon as they do.
  useEffect(() => {
    if (!queued || !fresh) return;
    setQueued(null);
    const result = grouped.flat[queued.index];
    if (result) execute(result, queued.alt);
  }, [queued, fresh, grouped, execute]);

  const pick = (choice: QueuedPick) => {
    if (!query.trim()) return;
    const result = grouped.flat[choice.index];
    if (fresh && result) execute(result, choice.alt);
    else setQueued(choice);
  };

  const hide = useCallback(() => {
    safeInvoke('palette:hide', undefined).catch((error: unknown) => reportError('palette:hide', error));
  }, []);

  const runEscape = (action: EscapeAction) => {
    if (action === 'cancel-run') agent.cancelRun();
    else if (action === 'cancel-voice') safeInvoke('voice:cancel', undefined).catch((e: unknown) => reportError('voice:cancel', e));
    else if (action === 'back-to-search') backToSearch();
    else if (action === 'clear') resetState('');
    else hide();
  };

  const runCommand = (command: PaletteCommand) => {
    const flat = grouped.flat;
    if (command.type === 'move') setActive(moveActive(activeIndex, command.delta, flat.length));
    else if (command.type === 'execute') {
      if (view === 'search') pick({ index: activeIndex, alt: command.alt });
      else ask(query);
    } else if (command.type === 'quick') pick({ index: command.index, alt: command.alt });
    else if (command.type === 'jump-ask') setActive(askIndex(flat));
    else runEscape(resolveEscape({ view, query, busy: view === 'ask' ? agent.askBusy : agent.voiceBusy }));
  };

  const pending = view === 'ask' ? agent.askPending : view === 'voice' ? agent.voicePending : null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const yes = pending ? confirmKey(event.key, query === '') : null;
    if (pending && yes !== null && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      answer(pending, yes);
      return;
    }
    const command = commandForKey(event.nativeEvent, isMac);
    const context = { view, resultCount: grouped.flat.length, hasAskRow: askIndex(grouped.flat) >= 0 };
    if (!command || !handlesCommand(command, context)) return;
    event.preventDefault();
    runCommand(command);
  };

  const toggleMic = () => {
    if (snapshot.phase === 'listening') {
      safeInvoke('voice:stop', undefined).catch((error: unknown) => reportError('voice:stop', error));
      return;
    }
    startVoice();
  };

  // palette:open resets everything; the latest callbacks are read through a ref.
  const onOpen = useRef({ startVoice, focusInput, resetState });
  useEffect(() => {
    onOpen.current = { startVoice, focusInput, resetState };
  });
  useEffect(
    () =>
      safeOn('palette:open', ({ mode, query: initial }) => {
        const latest = onOpen.current;
        latest.resetState(initial ?? '');
        setOpenCount((n) => n + 1);
        latest.focusInput(true);
        if (mode === 'voice') latest.startVoice();
      }),
    [],
  );

  // Never flash the last session's content when the window is shown again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onOpen.current.resetState('');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const onFocus = () => focusInput(false);
    window.addEventListener('focus', onFocus);
    focusInput(false);
    return () => window.removeEventListener('focus', onFocus);
  }, [focusInput]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setActive(0);
    setQueued(null);
    setNotice(null);
  };

  return {
    inputRef, view, query, snapshot, voiceSnapshot, book, search, grouped, activeIndex, notice, openCount, agent,
    pending, setActive, onQueryChange, onKeyDown, execute, ask, answer, toggleMic, backToSearch, hide,
  };
}

export type PaletteController = ReturnType<typeof usePalette>;
