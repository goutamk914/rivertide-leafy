// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeChannel } from '../../../../src/shared/ipc-channels';
import type { RivertideBridge } from '../../../../src/shared/ipc';
import { PresentationProvider } from '../../../../src/renderer/dashboard/app-context';
import { InsightsPage } from '../../../../src/renderer/dashboard/pages/insights/InsightsPage';
import { DISCLAIMER, DYNAMICS_ERROR, NOT_READY } from '../../../../src/renderer/dashboard/pages/insights/DynamicsSection';
import { USAGE_ERROR } from '../../../../src/renderer/dashboard/pages/insights/UsageSection';
import type { Route } from '../../../../src/renderer/lib/router';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from '../helpers';

const ROUTE: Route = { name: 'insights', section: null, path: '/insights' };

function usageSection() {
  return screen.getByRole('region', { name: 'Usage' });
}

function dynamicsSection() {
  return screen.getByRole('region', { name: 'Speech dynamics' });
}

/** Makes one channel fail while every other channel keeps using the mock. */
function failChannel(bridge: MockBridge, failing: InvokeChannel) {
  const original = bridge.invoke.bind(bridge);
  return vi.spyOn(bridge, 'invoke').mockImplementation(((channel: InvokeChannel, request: never) =>
    channel === failing ? Promise.reject(new Error('disk unavailable')) : original(channel, request)) as RivertideBridge['invoke']);
}

describe('InsightsPage', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it('shows the usage figures and both kinds of chart once data loads', async () => {
    // Arrange + Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(await screen.findByRole('img', { name: /Words per day/ })).toBeTruthy();
    const usage = usageSection();
    expect(within(usage).getByText('Streak')).toBeTruthy();
    expect(within(usage).getByText('Dictations')).toBeTruthy();
    expect(within(usage).getByRole('list', { name: 'Top apps by sessions' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Fog index/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Pace/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Pauses/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Filler words/ })).toBeTruthy();
  });

  it('reads the latest speech reading gently and always shows the disclaimer', async () => {
    // Arrange + Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(await screen.findByText(/^Your speech look(s|ed) /)).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByText('Your usual range')).toBeTruthy();
    expect(screen.getByText('You tend to speak a little more slowly after 6 pm.')).toBeTruthy();
  });

  it('explains that insights need a few days when there are too few sessions', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, dynamics: s.dynamics.slice(0, 2) }));

    // Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(await screen.findByText(NOT_READY)).toBeTruthy();
    const dynamics = dynamicsSection();
    expect(within(dynamics).queryByRole('img', { name: /Fog index/ })).toBeNull();
    expect(within(dynamics).queryByRole('button', { name: 'Show as table' })).toBeNull();
    expect(screen.queryByText(/^Your speech look/)).toBeNull();
  });

  it('swaps the usage charts for tables and back', async () => {
    // Arrange
    renderUi(<InsightsPage route={ROUTE} />);
    await screen.findByRole('img', { name: /Words per day/ });

    // Act
    fireEvent.click(within(usageSection()).getByRole('button', { name: 'Show as table' }));

    // Assert
    const table = screen.getByRole('table', { name: 'Words and sessions per day' });
    expect(within(table).getAllByRole('row').length).toBe(15);
    expect(screen.getByRole('table', { name: 'Top apps by sessions' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Words per day/ })).toBeNull();

    // Act
    fireEvent.click(within(usageSection()).getByRole('button', { name: 'Show as chart' }));

    // Assert
    expect(screen.getByRole('img', { name: /Words per day/ })).toBeTruthy();
  });

  it('shows the speech dynamics as tables, with missing days spelled out', async () => {
    // Arrange
    renderUi(<InsightsPage route={ROUTE} />);
    await screen.findByRole('img', { name: /Fog index/ });

    // Act
    fireEvent.click(within(dynamicsSection()).getByRole('button', { name: 'Show as table' }));

    // Assert
    expect(screen.getByRole('table', { name: 'Fog index per day' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Pace per day' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Pauses per day' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Filler words per day' })).toBeTruthy();
    expect(screen.getAllByText('No sessions').length).toBeGreaterThan(0);
  });

  it('refetches both sections when the range changes', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    renderUi(<InsightsPage route={ROUTE} />);
    await screen.findByRole('img', { name: /Words per day/ });

    // Act
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));

    // Assert
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('insights:usage', { days: 30 }));
    expect(invoke).toHaveBeenCalledWith('insights:dynamics', { days: 30 });
    expect(screen.getByRole('radio', { name: '30 days' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(within(usageSection()).getAllByText('in the last 30 days').length).toBe(2));
  });

  it('opens on the range named in the route', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');

    // Act
    renderUi(<InsightsPage route={{ ...ROUTE, section: '90', path: '/insights/90' }} />);

    // Assert
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('insights:usage', { days: 90 }));
    expect(screen.getByRole('radio', { name: '90 days' }).getAttribute('aria-checked')).toBe('true');
  });

  it('reloads usage when the history changes', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    renderUi(<InsightsPage route={ROUTE} />);
    await screen.findByRole('img', { name: /Words per day/ });
    const before = invoke.mock.calls.filter(([channel]) => channel === 'insights:usage').length;

    // Act
    act(() => bridge.emit('data:changed', { domain: 'history' }));

    // Assert
    await waitFor(() => expect(invoke.mock.calls.filter(([channel]) => channel === 'insights:usage').length).toBe(before + 1));
  });

  it('reads a day out when the chart is moved with the keyboard', async () => {
    // Arrange
    renderUi(<InsightsPage route={ROUTE} />);
    const plot = await screen.findByRole('group', { name: /^Fog index\. Use the arrow keys/ });

    // Act
    act(() => plot.focus());
    fireEvent.keyDown(plot, { key: 'Home' });

    // Assert
    const live = plot.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/^\w{3}, \w{3} \d+: (Fog index \d+|no sessions)$/);
    expect(plot.querySelector('.ins-tip')).not.toBeNull();
    expect(plot.querySelector('.ins-crosshair')).not.toBeNull();

    // Act
    act(() => plot.blur());

    // Assert
    expect(plot.querySelector('.ins-tip')).toBeNull();
  });

  it('highlights the focused column in the words chart', async () => {
    // Arrange
    renderUi(<InsightsPage route={ROUTE} />);
    const plot = await screen.findByRole('group', { name: /^Words per day\./ });

    // Act
    act(() => plot.focus());
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });

    // Assert
    expect(plot.querySelector('.ins-columns--focus')).not.toBeNull();
    expect(plot.querySelector('[aria-live="polite"]')?.textContent).toMatch(/: (\d[\d,]* words?|no sessions)$/);
  });

  it('shows a retry when usage fails to load, and recovers', async () => {
    // Arrange
    const invoke = failChannel(bridge, 'insights:usage');
    renderUi(<InsightsPage route={ROUTE} />);
    expect(await screen.findByText(USAGE_ERROR)).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Fog index/ })).toBeTruthy();

    // Act
    invoke.mockRestore();
    fireEvent.click(within(usageSection()).getByRole('button', { name: 'Try again' }));

    // Assert
    expect(await screen.findByRole('img', { name: /Words per day/ })).toBeTruthy();
    expect(screen.queryByText(USAGE_ERROR)).toBeNull();
  });

  it('shows a retry when speech dynamics fail to load', async () => {
    // Arrange
    failChannel(bridge, 'insights:dynamics');

    // Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(await screen.findByText(DYNAMICS_ERROR)).toBeTruthy();
    expect(within(dynamicsSection()).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows chart-shaped placeholders before the first result', () => {
    // Arrange + Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(screen.getByRole('status', { name: 'Loading usage' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading speech dynamics' })).toBeTruthy();
  });

  it('says so plainly when nothing has been recorded in the range', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, history: [] }));

    // Act
    renderUi(<InsightsPage route={ROUTE} />);

    // Assert
    expect(await screen.findByText('No words in this range yet.')).toBeTruthy();
    expect(screen.getByText('No apps in this range yet.')).toBeTruthy();
  });

  it('keeps only the reading, the fog chart, the disclaimer and the figures in calm mode', async () => {
    // Arrange
    const settings = bridge.getState().settings;
    const calm = { ...settings, appearance: { ...settings.appearance, calmMode: 'on' as const } };

    // Act
    renderUi(
      <PresentationProvider settings={calm}>
        <InsightsPage route={ROUTE} />
      </PresentationProvider>,
    );

    // Assert
    expect(await screen.findByRole('img', { name: /Fog index/ })).toBeTruthy();
    expect(screen.getByText(/^Your speech look/)).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(within(usageSection()).getByText('Streak')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Words per day/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Top apps by sessions' })).toBeNull();
    expect(screen.queryByRole('img', { name: /^Pace/ })).toBeNull();
    expect(screen.queryByText('What Rivertide noticed')).toBeNull();
  });
});
