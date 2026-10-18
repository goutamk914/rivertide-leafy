/** Web tools: open_url, web_search, compose_email (opens a draft, never sends). */
import { z } from 'zod';
import { clip, defineTool, errorText, fail, ok } from './types';

const httpUrl = z.string().trim().max(2000).url().refine((url) => /^https?:\/\//i.test(url), 'Only web links (http or https).');

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url; // validated by zod already; this is only for the spoken summary
  }
};

export const openUrlTool = defineTool({
  name: 'open_url',
  description: 'Open a web page (http or https link) in the default browser.',
  risk: 'act',
  egress: true,
  schema: z.object({ url: httpUrl }),
  title: ({ url }) => `Open ${hostOf(url)}`,
  async run({ url }, context) {
    try {
      await context.app.os.openUrl(url);
      return ok(`Opened ${hostOf(url)}.`);
    } catch (error) {
      return fail(errorText(error, 'I couldn’t open that link.'));
    }
  },
});

export const webSearchTool = defineTool({
  name: 'web_search',
  description: 'Search the web in the default browser (shows results to the person; you do not see them).',
  risk: 'act',
  egress: true,
  schema: z.object({ query: z.string().trim().min(1).max(300) }),
  title: ({ query }) => `Search the web for “${clip(query, 40)}”`,
  async run({ query }, context) {
    try {
      await context.app.os.webSearch(query);
      return ok(`Here are web results for ${query}.`);
    } catch (error) {
      return fail(errorText(error, 'I couldn’t open the browser.'));
    }
  },
});

/** mailto: link with encoded fields (RFC 6068). */
export function mailtoUrl(input: { readonly to?: string; readonly subject?: string; readonly body?: string }): string {
  const params = [
    input.subject ? `subject=${encodeURIComponent(input.subject)}` : null,
    input.body ? `body=${encodeURIComponent(input.body)}` : null,
  ].filter((part): part is string => part !== null);
  return `mailto:${input.to ? encodeURIComponent(input.to).replace(/%40/g, '@') : ''}${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

export const composeEmailTool = defineTool({
  name: 'compose_email',
  description: 'Open a new email draft in the person’s mail app with optional recipient, subject and body. It never sends; the person reviews and presses Send.',
  risk: 'act',
  egress: true,
  schema: z.object({
    to: z.string().trim().email().max(200).optional(),
    subject: z.string().trim().max(200).optional(),
    body: z.string().max(5000).optional(),
  }),
  title: ({ to }) => (to ? `Email ${to}` : 'New email'),
  async run(input, context) {
    try {
      await context.app.os.openUrl(mailtoUrl(input));
      return ok('I opened a new email. It won’t send until you press Send.');
    } catch (error) {
      return fail(errorText(error, 'I couldn’t open your mail app.'));
    }
  },
});
