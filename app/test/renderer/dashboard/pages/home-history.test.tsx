// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from '../../../../src/renderer/dashboard/pages/history/HistoryPage';
import { HomePage } from '../../../../src/renderer/dashboard/pages/home/HomePage';
import { ToastRegion } from '../../../../src/renderer/ui/components';
import { parseRoute } from '../../../../src/renderer/lib/router';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from '../helpers';

let bridge: MockBridge;

beforeEach(() => {
  bridge = setupBridge();
  window.location.hash = '#/';
});

afterEach(() => {
  cleanup();
  bridge.dispose();
  vi.useRealTimers();
});

describe('HomePage', () => {
  it('greets by name and shows today, speech, recent activity and reminders', async () => {
    // Arrange + Act
    renderUi(<HomePage route={parseRoute('/')} />);

    // Assert
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Sam$/);
    expect(await screen.findByText('words spoken')).toBeTruthy();
    expect(await screen.findByText(/Your speech looks/)).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'See all history' })).toBeTruthy();
    expect(await screen.findByText('Take evening medicines')).toBeTruthy();
  });

  it('explains insights are not ready yet without a baseline', async () => {
    bridge.setState((s) => ({ ...s, dynamics: s.dynamics.slice(0, 2) }));
    renderUi(<HomePage route={parseRoute('/')} />);
    expect(await screen.findByText('Insights appear after a few days of talking with Rivertide.')).toBeTruthy();
  });

  it('starts dictation from the quick actions', async () => {
    // Arrange
    const phases: string[] = [];
    bridge.on('voice:snapshot', (s) => phases.push(s.phase));
    renderUi(<HomePage route={parseRoute('/')} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));

    // Assert
    await waitFor(() => expect(phases[0]).toBe('listening'));
  });

  it('sets a timer from the dialog', async () => {
    // Arrange
    renderUi(<><HomePage route={parseRoute('/')} /><ToastRegion /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Set a timer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set a timer' });

    // Act
    fireEvent.click(within(dialog).getByRole('radio', { name: '20 min' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));

    // Assert
    expect(await screen.findByText('Timer set for 20 minutes.')).toBeTruthy();
    expect(bridge.getState().reminders.some((r) => r.kind === 'timer' && r.text === 'Timer')).toBe(true);
  });
});

describe('HistoryPage', () => {
  it('lists items grouped by day and shows the first one in detail with a diff', async () => {
    // Arrange + Act
    renderUi(<HistoryPage route={parseRoute('/history')} />);

    // Assert
    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paste again' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy' }).length).toBe(1);
  });

  it('filters by mode', async () => {
    // Arrange
    renderUi(<HistoryPage route={parseRoute('/history')} />);
    await screen.findByRole('heading', { level: 2, name: 'Today' });

    // Act
    fireEvent.click(screen.getByRole('radio', { name: 'Ask' }));

    // Assert
    await waitFor(() => {
      const list = screen.getByRole('region', { name: 'History list' });
      const badges = within(list).getAllByText(/^(Dictation|Ask|Leafy)$/);
      expect(badges.every((b) => b.textContent === 'Ask')).toBe(true);
    });
  });

  it('shows a plain empty state when nothing matches the search', async () => {
    renderUi(<HistoryPage route={parseRoute('/history')} />);
    await screen.findByRole('heading', { level: 2, name: 'Today' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), { target: { value: 'zzzz-no-match' } });
    expect(await screen.findByText('Nothing matches that.')).toBeTruthy();
  });

  it('deletes with undo and only commits after the undo window', async () => {
    // Arrange
    const first = bridge.getState().history[0];
    renderUi(<><HistoryPage route={parseRoute(`/history/${first?.id}`)} /><ToastRegion /></>);
    await screen.findByRole('button', { name: 'Paste again' });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    act(() => {
      fireEvent.click(undo);
    });

    // Assert
    expect(bridge.getState().history.some((h) => h.id === first?.id)).toBe(true);
  });

  it('commits the delete when the toast is dismissed', async () => {
    const first = bridge.getState().history[0];
    renderUi(<><HistoryPage route={parseRoute(`/history/${first?.id}`)} /><ToastRegion /></>);
    await screen.findByRole('button', { name: 'Paste again' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(bridge.getState().history.some((h) => h.id === first?.id)).toBe(false));
  });

  it('pastes again through main', async () => {
    renderUi(<><HistoryPage route={parseRoute('/history')} /><ToastRegion /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Paste again' }));
    expect(await screen.findByText('Pasted where your cursor was.')).toBeTruthy();
  });

  it('shows the welcome empty state with no history', async () => {
    bridge.setState((s) => ({ ...s, history: [] }));
    renderUi(<HistoryPage route={parseRoute('/history')} />);
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
  });
});
