/** App tools: open_app, quit_app. */
import { z } from 'zod';
import type { AppEntry } from '../../services';
import { defineTool, errorText, fail, ok, orList, type ToolContext, type ToolOutcome } from './types';

const appName = z.string().trim().min(1).max(80).describe('The app name as the person said it, e.g. "Calendar", "Spotify", "browser".');

function resolveApp(name: string, context: ToolContext): AppEntry | ToolOutcome {
  const entry = context.app.os.apps.find(name);
  if (entry) return entry;
  const nearby = context.app.os.apps.search(name, 5);
  context.remember({ kind: 'apps', items: nearby.map((app) => ({ name: app.name, path: app.path })) });
  const suggestions = nearby.slice(0, 3).map((app) => app.name);
  return fail(
    suggestions.length > 0 ? `I couldn’t find an app called ${name}. Did you mean ${orList(suggestions)}?` : `I couldn’t find an app called ${name} on this computer.`,
    { suggestions },
  );
}

const isEntry = (value: AppEntry | ToolOutcome): value is AppEntry => 'path' in value;

export const openAppTool = defineTool({
  name: 'open_app',
  description: 'Open an application on this computer (launches it or brings it to the front). Use for "open/launch/start/switch to <app>".',
  risk: 'act',
  schema: z.object({ name: appName }),
  title: ({ name }) => `Open ${name}`,
  async run({ name }, context) {
    const resolved = resolveApp(name, context);
    if (!isEntry(resolved)) return resolved;
    try {
      await context.app.os.apps.open(resolved);
      return ok(`Opened ${resolved.name}.`, { app: resolved.name });
    } catch (error) {
      return fail(errorText(error, `I couldn’t open ${resolved.name}.`));
    }
  },
});

export const quitAppTool = defineTool({
  name: 'quit_app',
  description: 'Quit (close) an application. The person is asked to confirm first. Use for "quit/close <app>".',
  risk: 'confirm',
  schema: z.object({ name: appName }),
  title: ({ name }) => `Quit ${name}`,
  confirmText: ({ name }) => `Quit ${name}? If something there isn’t saved, it may ask you first.`,
  async run({ name }, context) {
    if (!context.os) return fail('Quitting apps isn’t available on this computer yet.');
    const resolved = resolveApp(name, context);
    if (!isEntry(resolved)) return resolved;
    try {
      await context.os.quitApp(resolved);
      return ok(`Quit ${resolved.name}.`, { app: resolved.name });
    } catch (error) {
      return fail(errorText(error, `I couldn’t quit ${resolved.name}.`));
    }
  },
});
