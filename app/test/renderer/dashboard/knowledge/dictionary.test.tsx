// @vitest-environment jsdom
// Field errors appear twice by design: visibly under the field and in its always-present live region.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { setupBridge } from '../helpers';
import { renderKnowledge } from './render-knowledge';

const PATH = '#/knowledge/dictionary';

describe('Knowledge — Dictionary', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it('lists words in a real table with headers, chips and sources', async () => {
    // Arrange + Act
    renderKnowledge(PATH);

    // Assert
    const table = await screen.findByRole('table', { name: /Your dictionary, 5 words/ });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Word', 'Replaces', 'Uses', 'Source', 'Actions']);
    const row = within(table).getByRole('rowheader', { name: /Oxaliplatin/ }).closest('tr') as HTMLElement;
    expect(within(row).getByText('ox ally platin')).toBeTruthy();
    expect(within(row).getByText('Added by you')).toBeTruthy();
    expect(screen.getByText('Add names and medicines Rivertide mishears.')).toBeTruthy();
  });

  it('adds a word with its mishearings after the form is valid', async () => {
    // Arrange
    renderKnowledge(PATH);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Add a word' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a word' });

    // Act — blank word is rejected
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add word' }));
    expect(await within(dialog).findAllByText(/Add the word as it should be spelled/)).toBeTruthy();

    // Act — fill it in (duplicates collapse) and save
    fireEvent.change(within(dialog).getByLabelText('Word'), { target: { value: 'Capecitabine' } });
    fireEvent.change(within(dialog).getByLabelText(/Replaces/), { target: { value: 'cape sita bean, cap site a bean, Cape Sita Bean' } });
    expect(within(within(dialog).getByRole('list', { name: 'Mishearings to replace' })).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Chemo tablet' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add word' }));

    // Assert
    await waitFor(() => expect(bridge.getState().dictionary.some((d) => d.term === 'Capecitabine')).toBe(true));
    const saved = bridge.getState().dictionary.find((d) => d.term === 'Capecitabine');
    expect(saved).toMatchObject({ replaces: ['cape sita bean', 'cap site a bean'], note: 'Chemo tablet', source: 'manual' });
    expect(await screen.findByRole('rowheader', { name: /Capecitabine/ })).toBeTruthy();
  });

  it('edits a word', async () => {
    // Arrange
    renderKnowledge(PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Priya' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit word' });

    // Act
    fireEvent.change(within(dialog).getByLabelText(/Replaces/), { target: { value: 'pria, preya, pree ya' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    // Assert
    await waitFor(() => expect(bridge.getState().dictionary.find((d) => d.term === 'Priya')?.replaces).toEqual(['pria', 'preya', 'pree ya']));
  });

  it('deletes a word with an Undo window', async () => {
    // Arrange
    renderKnowledge(PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete neuropathy' }));
    const toasts = screen.getByRole('region', { name: 'Notifications' });

    // Act
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: /neuropathy/ })).toBeNull());
    fireEvent.click(within(toasts).getByRole('button', { name: 'Undo' }));

    // Assert
    expect(await screen.findByRole('rowheader', { name: /neuropathy/ })).toBeTruthy();
    expect(bridge.getState().dictionary.some((d) => d.term === 'neuropathy')).toBe(true);
  });

  it('shows an empty state with an add action when the dictionary is empty', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, dictionary: [] }));

    // Act
    renderKnowledge(PATH);

    // Assert
    expect(await screen.findByText('No words yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
