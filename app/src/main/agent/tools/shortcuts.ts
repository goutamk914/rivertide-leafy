/** Apple Shortcuts tools: list_shortcuts, run_shortcut. */
import { z } from 'zod';
import { clip, defineTool, errorText, fail, ok, plural } from './types';

const LIST_LIMIT = 50;

export const listShortcutsTool = defineTool({
  name: 'list_shortcuts',
  description: 'List the person’s Apple Shortcuts by name (macOS).',
  risk: 'read',
  schema: z.object({}),
  title: () => 'List Shortcuts',
  async run(_input, context) {
    if (!context.os) return fail('Shortcuts aren’t available on this computer.');
    try {
      const names = (await context.os.shortcuts.list()).slice(0, LIST_LIMIT);
      return ok(names.length > 0 ? `You have ${plural(names.length, 'shortcut')}.` : 'You don’t have any Shortcuts yet.', { shortcuts: names });
    } catch (error) {
      return fail(errorText(error, 'I couldn’t read your Shortcuts.'));
    }
  },
});

export const runShortcutTool = defineTool({
  name: 'run_shortcut',
  description: 'Run one of the person’s Apple Shortcuts by its exact name (check list_shortcuts if unsure). The person is asked to confirm first.',
  risk: 'confirm',
  untrustedOutput: true,
  schema: z.object({ name: z.string().trim().min(1).max(120) }),
  title: ({ name }) => `Run “${clip(name, 40)}”`,
  confirmText: ({ name }) => `Run your “${clip(name, 60)}” shortcut?`,
  async run({ name }, context) {
    if (!context.os) return fail('Shortcuts aren’t available on this computer.');
    try {
      const result = await context.os.shortcuts.run(name);
      return ok(`Ran “${result.name}”.`, result.output ? { output: result.output } : undefined);
    } catch (error) {
      return fail(errorText(error, `The “${name}” shortcut didn’t run.`));
    }
  },
});
