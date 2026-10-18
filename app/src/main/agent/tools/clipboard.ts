/** Clipboard and typing tools: copy_to_clipboard, read_clipboard, type_text. */
import { z } from 'zod';
import { clip, defineTool, errorText, fail, ok } from './types';

const CLIPBOARD_READ_LIMIT = 4000;

export const copyToClipboardTool = defineTool({
  name: 'copy_to_clipboard',
  description: 'Put text on the clipboard so the person can paste it.',
  risk: 'act',
  schema: z.object({ text: z.string().min(1).max(20_000) }),
  title: () => 'Copy to clipboard',
  async run({ text }, context) {
    context.app.os.copy(text);
    return ok('Copied to the clipboard.');
  },
});

export const readClipboardTool = defineTool({
  name: 'read_clipboard',
  description: 'Read the text currently on the clipboard (only when the person asks about it).',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({}),
  title: () => 'Read the clipboard',
  async run(_input, context) {
    if (!context.os) return fail('Reading the clipboard isn’t available on this computer yet.');
    try {
      const text = (await context.os.readClipboard()).trim();
      if (!text) return ok('The clipboard is empty.', { text: '' });
      return ok('Here’s what’s on the clipboard.', { text: clip(text, CLIPBOARD_READ_LIMIT) });
    } catch (error) {
      return fail(errorText(error, 'I couldn’t read the clipboard.'));
    }
  },
});

/** Everything that will be typed is shown in the confirmation, so the text is capped at that size. */
export const TYPE_TEXT_MAX_CHARS = 500;

export const typeTextTool = defineTool({
  name: 'type_text',
  description: `Type up to ${TYPE_TEXT_MAX_CHARS} characters at the cursor in the app the person is using. The person sees the full text and confirms first.`,
  risk: 'confirm',
  schema: z.object({ text: z.string().min(1).max(TYPE_TEXT_MAX_CHARS) }),
  title: ({ text }) => `Type “${clip(text, 30)}”`,
  confirmText: ({ text }) => `Type this where your cursor is? “${text}”`,
  async run({ text }, context) {
    const typed = await context.app.os.typeText(text);
    return typed ? ok('Typed it.') : fail('I couldn’t type there. Rivertide may need Accessibility permission in System Settings.');
  },
});
