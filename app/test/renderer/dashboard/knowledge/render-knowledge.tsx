/** Render helpers for Knowledge page tests: the page plus the toast region (Undo lives in toasts). */
import type { RenderResult } from '@testing-library/react';
import type { InvokeChannel } from '@shared/ipc-channels';
import type { Settings } from '@shared/settings';
import type { RivertideBridge } from '@shared/ipc';
import { KnowledgePage } from '../../../../src/renderer/dashboard/pages/knowledge/KnowledgePage';
import { PresentationProvider } from '../../../../src/renderer/dashboard/app-context';
import { installMockBridge } from '../../../../src/renderer/lib/ipc';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { parseRoute } from '../../../../src/renderer/lib/router';
import { ToastRegion } from '../../../../src/renderer/ui/components';
import { renderUi } from '../helpers';

export function renderKnowledge(path = '#/knowledge'): RenderResult {
  return renderUi(
    <>
      <KnowledgePage route={parseRoute(path)} />
      <ToastRegion />
    </>,
  );
}

/** Renders inside the real PresentationProvider so calm mode and reduced motion come from settings. */
export function renderWithAppearance(bridge: MockBridge, appearance: Partial<Settings['appearance']>, path = '#/knowledge'): RenderResult {
  const current = bridge.getState().settings;
  const settings: Settings = { ...current, appearance: { ...current.appearance, ...appearance } };
  return renderUi(
    <PresentationProvider settings={settings}>
      <KnowledgePage route={parseRoute(path)} />
      <ToastRegion />
    </PresentationProvider>,
  );
}

/** Installs a bridge that fails one channel with `message` and forwards everything else to `bridge`. */
export function failChannel(bridge: MockBridge, channel: InvokeChannel, message: string): void {
  const failing: RivertideBridge = {
    ...bridge,
    invoke: ((name: InvokeChannel, request: never) =>
      name === channel ? Promise.reject(new Error(message)) : bridge.invoke(name, request)) as RivertideBridge['invoke'],
  };
  installMockBridge(failing);
}

export function resetRootAttributes(): void {
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.reduceMotion;
  delete root.dataset.calm;
  root.removeAttribute('style');
}
