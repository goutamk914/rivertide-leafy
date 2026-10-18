import { useEffect, useRef, useState, type ComponentType } from 'react';
import { MotionConfig } from 'motion/react';
import { LeafySprite } from '@rivertide/leafy';
import { navigate, routePath, type Route, type RouteName } from '../lib/router';
import { Button, ToastRegion, toast } from '../ui/components';
import { PresentationProvider, usePresentation } from './app-context';
import { useIpcEvent } from './hooks/useIpc';
import { useRoute } from './hooks/useRoute';
import { useVoiceSnapshot } from './hooks/useVoice';
import { ChatPage } from './pages/chat/ChatPage';
import { DocumentsPage } from './pages/documents/DocumentsPage';
import { HistoryPage } from './pages/history/HistoryPage';
import { HomePage } from './pages/home/HomePage';
import { InsightsPage } from './pages/insights/InsightsPage';
import { KnowledgePage } from './pages/knowledge/KnowledgePage';
import { NotesPage } from './pages/notes/NotesPage';
import { OnboardingPage } from './pages/onboarding/OnboardingPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { CalmNote } from './shell/CalmNote';
import { PAGE_TITLE_ID, type PageComponentProps } from './shell/Page';
import { Sidebar } from './shell/Sidebar';
import { TitleBar } from './shell/TitleBar';
import { useSettingsStore } from './state/settings-store';

const PAGES: Readonly<Record<Exclude<RouteName, 'onboarding'>, ComponentType<PageComponentProps>>> = {
  home: HomePage,
  history: HistoryPage,
  chat: ChatPage,
  knowledge: KnowledgePage,
  documents: DocumentsPage,
  notes: NotesPage,
  insights: InsightsPage,
  settings: SettingsPage,
};

/** Bridges main-process pushes (settings, navigation, toasts) into the window. */
function useMainEvents(): void {
  const receive = useSettingsStore((s) => s.receive);
  useIpcEvent('settings:changed', receive);
  useIpcEvent('navigate', ({ route }) => navigate(route));
  useIpcEvent('toast', ({ kind, message }) => {
    toast[kind](message);
  });
}

/**
 * Moves focus to the new page's heading when the page changes. Sub-section changes (tabs, selected
 * items) keep focus where it is, and the first load never moves it (StrictMode-safe: compares names).
 */
function useFocusOnRouteChange(route: Route): void {
  const previous = useRef(route.name);
  useEffect(() => {
    if (previous.current === route.name) return undefined;
    previous.current = route.name;
    const frame = requestAnimationFrame(() => document.getElementById(PAGE_TITLE_ID)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [route.name]);
}

function Shell({ route, useFn }: { readonly route: Route; readonly useFn: boolean }) {
  const voice = useVoiceSnapshot();
  const { calm } = usePresentation();
  const [calmDismissed, setCalmDismissed] = useState(false);
  useFocusOnRouteChange(route);
  const PageComponent = PAGES[route.name === 'onboarding' ? 'home' : route.name];
  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <Sidebar route={route} voice={voice} useFn={useFn} />
      <div className="main-col">
        <TitleBar voice={voice} />
        <main id="main" className="main" tabIndex={-1}>
          {calm && !calmDismissed ? <CalmNote onDismiss={() => setCalmDismissed(true)} /> : null}
          <PageComponent key={route.name} route={route} />
        </main>
      </div>
    </div>
  );
}

function Boot({ error, onRetry }: { readonly error: string | null; readonly onRetry: () => void }) {
  return (
    <div className="boot" role={error ? 'alert' : 'status'}>
      <div>
        <LeafySprite mood={error ? 'error' : 'idle'} scale={4} decorative />
        <p style={{ marginTop: 16 }}>{error ?? 'Opening Rivertide…'}</p>
        {error ? (
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={onRetry}>Try again</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadError = useSettingsStore((s) => s.loadError);
  const load = useSettingsStore((s) => s.load);
  const route = useRoute();
  useMainEvents();

  useEffect(() => {
    void load();
  }, [load]);

  const needsOnboarding = settings !== null && !settings.onboarded && route.name !== 'onboarding';
  useEffect(() => {
    if (needsOnboarding) navigate(routePath('onboarding'), { replace: true });
  }, [needsOnboarding]);

  if (!settings) return <Boot error={loadError} onRetry={() => void load()} />;
  const reduce = settings.appearance.reduceMotion;
  return (
    <MotionConfig reducedMotion={reduce === 'on' ? 'always' : reduce === 'off' ? 'never' : 'user'}>
      <PresentationProvider settings={settings}>
        {route.name === 'onboarding' ? <OnboardingPage route={route} /> : <Shell route={route} useFn={settings.hotkeys.useFn} />}
        <ToastRegion />
      </PresentationProvider>
    </MotionConfig>
  );
}
