// @vitest-environment jsdom
/**
 * Deep links (as the palette opens them), missing-item fallbacks, focus after delete, and the notes
 * draft/session behaviour. Pages are driven by the real hash route through `useRoute`.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRoute } from '../../../../src/renderer/dashboard/hooks/useRoute';
import { DocumentsPage, MISSING_DOCUMENT } from '../../../../src/renderer/dashboard/pages/documents/DocumentsPage';
import { HistoryPage, MISSING_HISTORY } from '../../../../src/renderer/dashboard/pages/history/HistoryPage';
import { KnowledgePage, MISSING_FACT } from '../../../../src/renderer/dashboard/pages/knowledge/KnowledgePage';
import { MISSING_NOTE } from '../../../../src/renderer/dashboard/pages/notes/NotesPanel';
import { NotesPage } from '../../../../src/renderer/dashboard/pages/notes/NotesPage';
import type { PageComponentProps } from '../../../../src/renderer/dashboard/shell/Page';
import { ToastRegion } from '../../../../src/renderer/ui/components';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from '../helpers';

let bridge: MockBridge;

function renderAt(hash: string, Page: ComponentType<PageComponentProps>) {
  window.location.hash = hash;
  function Routed() {
    const route = useRoute();
    return <Page route={route} />;
  }
  return renderUi(<><Routed /><ToastRegion /></>);
}

const nextFrames = () => act(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

beforeEach(() => {
  bridge = setupBridge();
});

afterEach(() => {
  cleanup();
  bridge.dispose();
  window.location.hash = '';
});

describe('history links', () => {
  it('opens an older item that is not in the first page of the list', async () => {
    // Arrange
    const old = bridge.getState().history.at(-1);

    // Act
    renderAt(`#/history/${old?.id}`, HistoryPage);

    // Assert
    const detail = await screen.findByRole('region', { name: 'Selected item' });
    // The raw pane reads exactly as heard (the diff keeps the transcript's own words).
    await waitFor(() => expect(detail.textContent).toContain(old?.raw ?? '—'));
  });

  it('falls back to History with a note when the item is gone', async () => {
    renderAt('#/history/gone123', HistoryPage);
    expect(await screen.findByText(MISSING_HISTORY)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/history'));
  });

  it('moves focus to the next item after a delete, and Undo works from the keyboard', async () => {
    // Arrange
    const [first, second] = bridge.getState().history;
    renderAt(`#/history/${first?.id}`, HistoryPage);
    await screen.findByRole('button', { name: 'Paste again' });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await nextFrames();

    // Assert
    expect(document.activeElement?.getAttribute('data-history-id')).toBe(second?.id);
    expect(window.location.hash).toBe(`#/history/${second?.id}`);
    expect(document.querySelector(`[data-history-id="${first?.id}"]`)).toBeNull();
    fireEvent.keyDown(document.activeElement as Element, { key: 'z', metaKey: true });
    await waitFor(() => expect(document.querySelector(`[data-history-id="${first?.id}"]`)).not.toBeNull());
    expect(screen.queryByText('Deleted from history.')).toBeNull();
  });
});

describe('document links', () => {
  it('opens the linked document', async () => {
    const doc = bridge.getState().documents[1];
    renderAt(`#/documents/${doc?.meta.id}`, DocumentsPage);
    expect(await screen.findByRole('heading', { level: 2, name: doc?.meta.name })).toBeTruthy();
  });

  it('falls back with a note when the document is gone', async () => {
    renderAt('#/documents/gone123', DocumentsPage);
    expect(await screen.findByText(MISSING_DOCUMENT)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/documents'));
  });
});

describe('note links and drafts', () => {
  it('opens the linked note, the reminders view and a new draft', async () => {
    const note = bridge.getState().notes[2];
    renderAt(`#/notes/${note?.id}`, NotesPage);
    expect(await screen.findByDisplayValue(note?.title ?? '—')).toBeTruthy();
    cleanup();
    renderAt('#/notes/reminders', NotesPage);
    expect(await screen.findByRole('heading', { name: 'Coming up' })).toBeTruthy();
    cleanup();
    renderAt('#/notes/new', NotesPage);
    expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('');
  });

  it('falls back with a note when the note is gone', async () => {
    renderAt('#/notes/gone123', NotesPage);
    expect(await screen.findByText(MISSING_NOTE)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
  });

  it('reopens a just-created note with its text, not a blank editor', async () => {
    // Arrange: create a note from a new draft.
    renderAt('#/notes/new', NotesPage);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Shopping list' } });
    await waitFor(() => expect(window.location.hash).not.toBe('#/notes/new'), { timeout: 4000 });
    const createdHash = window.location.hash;

    // Act: open another note, then the new one again.
    const other = bridge.getState().notes.find((n) => n.title === 'Groceries');
    fireEvent.click(await screen.findByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(window.location.hash).toBe(`#/notes/${other?.id}`));
    act(() => {
      window.location.hash = createdHash;
    });

    // Assert
    expect(await screen.findByDisplayValue('Shopping list')).toBeTruthy();
    expect(bridge.getState().notes.filter((n) => n.title === 'Shopping list')).toHaveLength(1);
  });

  it('does not pull you back to Notes when a draft is saved as you leave', async () => {
    // Arrange
    const view = renderAt('#/notes/new', NotesPage);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Quick thought' } });

    // Act: leave before the autosave delay; the unmount flush saves the draft.
    window.location.hash = '#/history';
    view.unmount();

    // Assert
    await waitFor(() => expect(bridge.getState().notes.some((n) => n.title === 'Quick thought')).toBe(true));
    expect(window.location.hash).toBe('#/history');
  });
});

describe('fact links', () => {
  it('opens the linked fact in its editor', async () => {
    const fact = bridge.getState().facts[3];
    renderAt(`#/knowledge/${fact?.id}`, KnowledgePage);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue(fact?.label ?? '—')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/knowledge/facts'));
  });

  it('falls back with a note when the fact is gone', async () => {
    renderAt('#/knowledge/gone123', KnowledgePage);
    expect(await screen.findByText(MISSING_FACT)).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/knowledge/facts'));
  });
});
