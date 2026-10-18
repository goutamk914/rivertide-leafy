/** Mock handlers for app, settings, secrets, providers, permissions, windows and the overlay windows. */
import { applySettingsPatch, PROVIDERS, type SecretId, type SettingsPatch } from '@shared/settings';
import type { HotkeyStatus, SearchResult } from '@shared/types';
import { dayKey } from '../format';
import { wipedState } from './data';
import { OK, type MockContext, type MockHandlers } from './context';

const ACCESSIBILITY_GRANT_DELAY_MS = 2500;

type SystemChannels =
  | 'app:info' | 'settings:get' | 'settings:update' | 'secrets:status' | 'secrets:set' | 'secrets:clear'
  | 'providers:test' | 'permissions:status' | 'permissions:request' | 'permissions:openSettings' | 'hotkeys:status'
  | 'palette:search' | 'palette:execute' | 'palette:hide' | 'palette:resize'
  | 'leafy:pointer' | 'leafy:moveTo' | 'leafy:dragEnd' | 'leafy:menu' | 'leafy:position' | 'island:pointer'
  | 'window:open' | 'window:close' | 'window:minimize' | 'data:export' | 'data:wipe' | 'system:openExternal'
  | 'engine:ready' | 'engine:capture' | 'engine:clap' | 'engine:voices' | 'engine:error';

function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

function testProvider(ctx: MockContext, kind: 'llm' | 'stt', providerId: string) {
  const info = PROVIDERS.find((p) => p.id === providerId);
  if (!info) return { ok: false, latencyMs: null, message: 'Rivertide doesn’t know that provider.' };
  if (providerId === 'ollama') {
    return { ok: false, latencyMs: null, message: 'Couldn’t reach Ollama on this computer. Open the Ollama app, then test again.' };
  }
  if (providerId === 'local') {
    return { ok: false, latencyMs: null, message: 'whisper-cli wasn’t found. Install it, then choose its model file.' };
  }
  const secretKey = (providerId === 'custom' && kind === 'stt' ? 'stt-custom' : providerId) as SecretId;
  if (info.needsKey && !ctx.get().secrets[secretKey]?.set) {
    return { ok: false, latencyMs: null, message: `Add a ${providerName(providerId)} key first.` };
  }
  const latencyMs = 280 + Math.round(Math.random() * 600);
  return { ok: true, latencyMs, message: `Connected to ${providerName(providerId)}.` };
}

function hotkeys(ctx: MockContext): HotkeyStatus[] {
  const { hotkeys: h } = ctx.get().settings;
  return (['palette', 'command', 'dictate'] as const).map((action) => ({
    action,
    accelerator: h[action],
    registered: h[action].trim().length > 0 && !/^Alt\+Space$/i.test(h[action]),
  }));
}

function paletteSearch(ctx: MockContext, query: string, limit: number): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const state = ctx.get();
  const facts = state.facts
    .filter((f) => `${f.label} ${f.value}`.toLowerCase().includes(q))
    .map((f): SearchResult => ({ id: f.id, kind: 'fact', title: f.label, subtitle: f.value, icon: 'icon:brain', score: 0.8 }));
  const notes = state.notes
    .filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q))
    .map((n): SearchResult => ({ id: n.id, kind: 'note', title: n.title || 'Untitled note', subtitle: n.body.slice(0, 80), icon: 'icon:sticky-note', score: 0.7 }));
  const ask: SearchResult = { id: 'ask', kind: 'ask', title: `Ask Leafy “${query.trim()}”`, subtitle: null, icon: 'icon:sprout', score: 0.1 };
  return [...facts, ...notes, ask].slice(0, limit);
}

export function systemHandlers(ctx: MockContext): Pick<MockHandlers, SystemChannels> {
  return {
    'app:info': () => ({
      version: '2.0.0',
      platform: 'darwin',
      arch: 'arm64',
      electron: '44.7.2',
      userDataPath: '~/Library/Application Support/Rivertide',
      isDev: true,
    }),
    'settings:get': () => ctx.get().settings,
    'settings:update': ({ patch }) => {
      let next;
      try {
        next = applySettingsPatch(ctx.get().settings, patch as SettingsPatch);
      } catch {
        throw new Error('That value isn’t allowed. Check the field and try again.');
      }
      ctx.set((s) => ({ ...s, settings: next }));
      ctx.emit('settings:changed', next);
      return next;
    },
    'secrets:status': () => ctx.get().secrets,
    'secrets:set': ({ id }) => {
      // The mock keeps only a "set" flag; it never stores the key itself.
      ctx.set((s) => ({ ...s, secrets: { ...s.secrets, [id]: { set: true } } }));
      return ctx.get().secrets;
    },
    'secrets:clear': ({ id }) => {
      ctx.set((s) => ({ ...s, secrets: { ...s.secrets, [id]: { set: false } } }));
      return ctx.get().secrets;
    },
    'providers:test': ({ kind, providerId }) => testProvider(ctx, kind, providerId),
    'permissions:status': () => ctx.get().permissions,
    'permissions:request': ({ kind }) => {
      if (kind === 'microphone') ctx.set((s) => ({ ...s, permissions: { ...s.permissions, microphone: 'granted' } }));
      if (kind === 'accessibility' || kind === 'input-monitoring') {
        ctx.schedule(() => ctx.set((s) => ({ ...s, permissions: { ...s.permissions, accessibility: true } })), ACCESSIBILITY_GRANT_DELAY_MS);
      }
      return ctx.get().permissions;
    },
    'permissions:openSettings': ({ kind }) => {
      if (kind === 'accessibility' || kind === 'input-monitoring') {
        ctx.schedule(() => ctx.set((s) => ({ ...s, permissions: { ...s.permissions, accessibility: true } })), ACCESSIBILITY_GRANT_DELAY_MS);
      }
      return OK;
    },
    'hotkeys:status': () => hotkeys(ctx),
    'palette:search': ({ query, limit }) => paletteSearch(ctx, query, limit ?? 12),
    'palette:execute': () => ({ ok: true, message: null }),
    'palette:hide': () => OK,
    'palette:resize': () => OK,
    'leafy:pointer': () => OK,
    'leafy:moveTo': () => OK,
    'leafy:dragEnd': () => OK,
    'leafy:menu': () => OK,
    'leafy:position': () => ({ x: 1180, y: 720, corner: 'right' as const }),
    'island:pointer': () => OK,
    'window:open': ({ route }) => {
      if (route) ctx.emit('navigate', { route });
      return OK;
    },
    'window:close': () => OK,
    'window:minimize': () => OK,
    'data:export': () => ({ path: `~/Downloads/Rivertide export ${dayKey(ctx.now())}` }),
    'data:wipe': () => {
      ctx.set((s) => wipedState(s));
      for (const domain of ['history', 'knowledge', 'dictionary', 'documents', 'chats', 'notes', 'reminders', 'dynamics'] as const) {
        ctx.emit('data:changed', { domain });
      }
      ctx.emit('settings:changed', ctx.get().settings);
      return OK;
    },
    'system:openExternal': ({ url }) => {
      ctx.emit('toast', { kind: 'info', message: `In the app, this opens ${new URL(url).host} in your browser.` });
      return OK;
    },
    'engine:ready': () => OK,
    'engine:capture': () => OK,
    'engine:clap': () => OK,
    'engine:voices': () => OK,
    'engine:error': () => OK,
  };
}
