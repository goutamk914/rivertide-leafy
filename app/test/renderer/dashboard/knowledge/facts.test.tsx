// @vitest-environment jsdom
// Field errors appear twice by design: visibly under the field and in its always-present live region.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { setupBridge } from '../helpers';
import { failChannel, renderKnowledge } from './render-knowledge';

const toasts = () => screen.getByRole('region', { name: 'Notifications' });
const hasFact = (bridge: MockBridge, label: string) => bridge.getState().facts.some((f) => f.label === label);

describe('Knowledge — Facts', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it('validates the add-fact form, then saves the fact', async () => {
    // Arrange
    renderKnowledge();
    await screen.findByText('Oxaliplatin');
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a fact' });

    // Act — empty submit shows inline errors and saves nothing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save fact' }));

    // Assert
    expect(await within(dialog).findAllByText(/Add a short label/)).toBeTruthy();
    expect(within(dialog).getAllByText(/Add what Leafy should remember/)).toBeTruthy();
    expect(bridge.getState().facts).toHaveLength(17);

    // Act — fill it in and save
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'preference' } });
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: '  Morning tea ' } });
    fireEvent.change(within(dialog).getByLabelText('What to remember'), { target: { value: 'Peppermint, no sugar.' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: /Pin this fact/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save fact' }));

    // Assert
    await waitFor(() => expect(hasFact(bridge, 'Morning tea')).toBe(true));
    const saved = bridge.getState().facts.find((f) => f.label === 'Morning tea');
    expect(saved).toMatchObject({ category: 'preference', value: 'Peppermint, no sugar.', pinned: true, source: 'manual' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Fact saved.')).toBeTruthy();
    expect(await screen.findByText('Morning tea')).toBeTruthy();
  });

  it('shows a label error as soon as the field is left empty', async () => {
    // Arrange
    renderKnowledge();
    await screen.findByText('Oxaliplatin');
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a fact' });
    const label = within(dialog).getByLabelText('Label');

    // Act
    fireEvent.blur(label);

    // Assert
    expect(await within(dialog).findAllByText(/Add a short label/)).toBeTruthy();
    expect(label.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).queryByText(/Add what Leafy should remember/)).toBeNull();
  });

  it('edits an existing fact from the list', async () => {
    // Arrange
    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Vitamin D' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit fact' });

    // Act
    fireEvent.change(within(dialog).getByLabelText('What to remember'), { target: { value: 'Two capsules on Sundays.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    // Assert
    await waitFor(() => expect(bridge.getState().facts.find((f) => f.label === 'Vitamin D')?.value).toBe('Two capsules on Sundays.'));
    expect(await screen.findByText('Two capsules on Sundays.')).toBeTruthy();
  });

  it('hides a deleted fact straight away and brings it back with Undo', async () => {
    // Arrange
    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Vitamin D' }));

    // Act
    await waitFor(() => expect(screen.queryByText('Vitamin D')).toBeNull());
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Undo' }));

    // Assert
    expect(await screen.findByText('Vitamin D')).toBeTruthy();
    expect(hasFact(bridge, 'Vitamin D')).toBe(true);
  });

  it('deletes for real once the Undo toast is dismissed', async () => {
    // Arrange
    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Vitamin D' }));
    expect(within(toasts()).getByText('Deleted “Vitamin D”.')).toBeTruthy();

    // Act
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Dismiss' }));

    // Assert
    await waitFor(() => expect(hasFact(bridge, 'Vitamin D')).toBe(false));
    expect(screen.queryByText('Vitamin D')).toBeNull();
  });

  it('brings the fact back and says so when deleting fails', async () => {
    // Arrange
    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Vitamin D' }));
    failChannel(bridge, 'knowledge:delete', 'The database is locked.');

    // Act
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Dismiss' }));

    // Assert
    expect(await screen.findByText(/Couldn’t delete it\. The database is locked\./)).toBeTruthy();
    expect(await screen.findByText('Vitamin D')).toBeTruthy();
  });

  it('pins a fact and keeps the pin', async () => {
    // Arrange
    renderKnowledge();
    const pin = await screen.findByRole('button', { name: 'Pin Vitamin D' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');

    // Act
    fireEvent.click(pin);

    // Assert
    await waitFor(() => expect(bridge.getState().facts.find((f) => f.label === 'Vitamin D')?.pinned).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pin Vitamin D' }).getAttribute('aria-pressed')).toBe('true'));
    expect(await screen.findByText('Pinned “Vitamin D”.')).toBeTruthy();
  });

  it('undoes the pin and explains when saving it fails', async () => {
    // Arrange
    renderKnowledge();
    const pin = await screen.findByRole('button', { name: 'Pin Vitamin D' });
    failChannel(bridge, 'knowledge:upsert', 'Saving is paused.');

    // Act
    fireEvent.click(pin);

    // Assert
    expect(await screen.findByText(/Couldn’t pin “Vitamin D”\. Saving is paused\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pin Vitamin D' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('says when a search matches nothing and clears it', async () => {
    // Arrange
    renderKnowledge();
    await screen.findByText('Oxaliplatin');

    // Act
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search facts' }), { target: { value: 'zebra crossing' } });
    expect(await screen.findByText('No facts match “zebra crossing”.')).toBeTruthy();
    const clearButtons = screen.getAllByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButtons[clearButtons.length - 1] as HTMLElement);

    // Assert
    expect(await screen.findByText('Oxaliplatin')).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Search facts' }) as HTMLInputElement).value).toBe('');
  });

  it('narrows the list to matching facts', async () => {
    // Arrange
    renderKnowledge();
    await screen.findByText('Oxaliplatin');

    // Act
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search facts' }), { target: { value: 'nausea' } });

    // Assert
    await waitFor(() => expect(screen.queryByText('Oxaliplatin')).toBeNull());
    expect(screen.getByText('Ondansetron')).toBeTruthy();
    expect(screen.getByText('Favourite tea')).toBeTruthy();
    expect(screen.getByText('2 facts match “nausea”.')).toBeTruthy();
  });

  it('shows Leafy and an add action when nothing is known yet', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, facts: [] }));

    // Act
    renderKnowledge();

    // Assert
    expect(await screen.findByText("Leafy hasn't learned anything yet.")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add a fact' })).toHaveLength(2);
  });

  it('shows a retry when facts fail to load', async () => {
    // Arrange
    failChannel(bridge, 'knowledge:list', 'Storage is unavailable.');

    // Act
    renderKnowledge();

    // Assert
    expect(await screen.findByText(/Couldn’t load your facts\. Storage is unavailable\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
