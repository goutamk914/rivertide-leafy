// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatPage, SAFETY_NOTE } from '../../../../src/renderer/dashboard/pages/chat/ChatPage';
import { STARTERS } from '../../../../src/renderer/dashboard/pages/chat/ChatThread';
import { DocumentsPage } from '../../../../src/renderer/dashboard/pages/documents/DocumentsPage';
import { NotesPage } from '../../../../src/renderer/dashboard/pages/notes/NotesPage';
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
});

describe('ChatPage', () => {
  it('shows sessions, the latest conversation with sources, and the safety note', async () => {
    renderUi(<ChatPage route={parseRoute('/chat')} />);
    expect(await screen.findByRole('link', { name: /Energy this week/ })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Sources' })).toBeTruthy();
    expect(screen.getByText(SAFETY_NOTE)).toBeTruthy();
  });

  it('streams a reply after sending with Enter', async () => {
    // Arrange
    renderUi(<ChatPage route={parseRoute('/chat')} />);
    const input = await screen.findByLabelText('Message Leafy');
    await screen.findByRole('list', { name: 'Sources' });

    // Act
    fireEvent.change(input, { target: { value: 'What questions should I ask at my visit?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Assert
    expect(await screen.findByText('What questions should I ask at my visit?')).toBeTruthy();
    expect(await screen.findByText(/you might ask/, {}, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Leafy is answering')).toBeNull(), { timeout: 5000 });
  });

  it('offers retry when a reply fails', async () => {
    renderUi(<ChatPage route={parseRoute('/chat')} />);
    const input = await screen.findByLabelText('Message Leafy');
    await screen.findByRole('list', { name: 'Sources' });
    fireEvent.change(input, { target: { value: 'please fail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 3000 });

    // Retrying resends the question without showing it twice.
    fireEvent.click(retry);
    await screen.findByText(/Leafy is thinking|Leafy is answering|Leafy couldn’t reach/);
    expect(screen.getAllByText('please fail')).toHaveLength(1);
  });

  it('starts a chat from a suggestion when there are no chats yet', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, chats: [] }));
    renderUi(<ChatPage route={parseRoute('/chat')} />);

    // Act
    fireEvent.click(await screen.findByRole('button', { name: STARTERS[0] }));

    // Assert
    await waitFor(() => expect(bridge.getState().chats).toHaveLength(1));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/));
  });

  it('asks before deleting a chat', async () => {
    renderUi(<ChatPage route={parseRoute('/chat')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Energy this week' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(bridge.getState().chats).toHaveLength(0));
  });

  it('renames a chat inline', async () => {
    renderUi(<ChatPage route={parseRoute('/chat')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Energy this week' }));
    const field = screen.getByRole('textbox', { name: 'Chat name' });
    fireEvent.change(field, { target: { value: 'My energy' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(bridge.getState().chats[0]?.title).toBe('My energy'));
  });
});

describe('DocumentsPage', () => {
  it('lists documents and shows the selected text', async () => {
    renderUi(<DocumentsPage route={parseRoute('/documents')} />);
    expect(await screen.findByRole('heading', { level: 2, name: /Chemo side effects handout/ })).toBeTruthy();
    expect(await screen.findByLabelText('Document text')).toBeTruthy();
    expect(screen.getByText(/They stay on this computer/)).toBeTruthy();
  });

  it('imports through the picker', async () => {
    renderUi(<><DocumentsPage route={parseRoute('/documents')} /><ToastRegion /></>);
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Added Picked sample.txt.')).toBeTruthy();
  });

  it('imports a dropped text file', async () => {
    // Arrange
    renderUi(<><DocumentsPage route={parseRoute('/documents')} /><ToastRegion /></>);
    await screen.findByLabelText('Document text');
    const file = new File(['My questions for Monday'], 'monday.txt', { type: 'text/plain' });
    const zone = document.querySelector('.docs') as HTMLElement;

    // Act
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });

    // Assert
    expect(await screen.findByText('Document added.')).toBeTruthy();
    expect(bridge.getState().documents.some((d) => d.meta.name === 'monday.txt')).toBe(true);
  });

  it('shows an empty state with an import action', async () => {
    bridge.setState((s) => ({ ...s, documents: [] }));
    renderUi(<DocumentsPage route={parseRoute('/documents')} />);
    expect(await screen.findByText('No documents yet.')).toBeTruthy();
  });
});

describe('NotesPage', () => {
  it('shows notes with the pinned one first and opens it in the editor', async () => {
    renderUi(<NotesPage route={parseRoute('/notes')} />);
    expect(await screen.findByDisplayValue('Questions for Dr. Ellis')).toBeTruthy();
  });

  it('creates a note once something is written', async () => {
    // Arrange
    const before = bridge.getState().notes.length;
    renderUi(<NotesPage route={parseRoute('/notes/new')} />);

    // Act
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Shopping' } });

    // Assert
    await waitFor(() => expect(bridge.getState().notes.length).toBe(before + 1), { timeout: 3000 });
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('lists upcoming reminders and creates a new one', async () => {
    // Arrange
    renderUi(<><NotesPage route={parseRoute('/notes/reminders')} /><ToastRegion /></>);
    expect(await screen.findByText('Take evening medicines')).toBeTruthy();

    // Act
    fireEvent.change(screen.getByLabelText('Remind me to'), { target: { value: 'Call Maya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    // Assert
    expect(await screen.findByText(/Reminder set for/)).toBeTruthy();
    expect(bridge.getState().reminders.some((r) => r.text === 'Call Maya')).toBe(true);
  });

  it('validates the reminder text before saving', async () => {
    renderUi(<NotesPage route={parseRoute('/notes/reminders')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set reminder' }));
    // Visible under the field and announced through the field's live region.
    expect((await screen.findAllByText('Say what the reminder is for.')).length).toBe(2);
    expect(document.activeElement).toBe(screen.getByLabelText('Remind me to'));
  });
});
