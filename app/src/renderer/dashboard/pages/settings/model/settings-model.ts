/** Pure helpers for Settings: validation, formatting and small record updates. */
import type { ProviderTestResult } from '@shared/ipc';
import { PROVIDERS, type SttProviderId } from '@shared/settings';
import type { SaveState } from '../../../state/settings-store';

export const NAME_MAX = 80;
export const MODEL_MAX = 120;
export const URL_MAX = 300;
export const PATH_MAX = 500;

const URL_PROBLEM = 'Use a full address that starts with http:// or https://.';

const tooLong = (max: number) => `Use ${max} characters or fewer.`;

export function validateName(value: string): string | null {
  return value.length > NAME_MAX ? tooLong(NAME_MAX) : null;
}

export function validateModel(value: string): string | null {
  if (!value.trim()) return 'Add a model name.';
  return value.length > MODEL_MAX ? tooLong(MODEL_MAX) : null;
}

export function validatePath(value: string): string | null {
  return value.length > PATH_MAX ? tooLong(PATH_MAX) : null;
}

/** Empty is fine unless `required`; otherwise an http(s) URL of at most 300 characters. */
export function validateHttpUrl(value: string, options: { readonly required?: boolean } = {}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return options.required ? 'Add the server address, starting with http:// or https://.' : null;
  if (trimmed.length > URL_MAX) return tooLong(URL_MAX);
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : URL_PROBLEM;
  } catch {
    return URL_PROBLEM;
  }
}

/** 'auto' or a two-letter ISO-639-1 code. */
export function validateLanguage(value: string): string | null {
  const code = value.trim().toLowerCase();
  return code === 'auto' || /^[a-z]{2}$/.test(code) ? null : 'Type auto, or a two-letter language code like en or es.';
}

/** New base-URL record with `id` set, or removed when `url` is blank (main then uses the default). */
export function withBaseUrl(record: Readonly<Record<string, string>>, id: string, url: string): Record<string, string> {
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
  const trimmed = url.trim();
  return trimmed ? { ...rest, [id]: trimmed } : rest;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export const msFromSeconds = (seconds: number): number => Math.round(seconds * 1000);
export const formatPercent = (scale: number): string => `${Math.round(scale * 100)}%`;
export const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
export const formatRate = (rate: number): string => `${rate.toFixed(2)}×`;

export function testResultText(result: ProviderTestResult): string {
  if (!result.ok) return result.message;
  return result.latencyMs === null ? 'Connected' : `Connected · ${result.latencyMs} ms`;
}

const RETENTION_CHOICES: readonly { readonly days: number; readonly label: string }[] = [
  { days: 0, label: 'Keep forever' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

/** Select options for history retention; an unusual saved value stays visible rather than vanishing. */
export function retentionOptions(current: number): readonly { readonly value: string; readonly label: string }[] {
  const options = RETENTION_CHOICES.map((c) => ({ value: String(c.days), label: c.label }));
  return RETENTION_CHOICES.some((c) => c.days === current)
    ? options
    : [...options, { value: String(current), label: `${current} days` }];
}

export type SaveTone = 'idle' | 'saving' | 'saved' | 'error';

export function saveStatus(state: SaveState, error: string | null): { readonly tone: SaveTone; readonly text: string } {
  switch (state) {
    case 'saving':
      return { tone: 'saving', text: 'Saving…' };
    case 'saved':
      return { tone: 'saved', text: 'Saved' };
    case 'error':
      return { tone: 'error', text: error ?? 'Your change wasn’t saved. Try again.' };
    default:
      return { tone: 'idle', text: 'Changes save automatically' };
  }
}

export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
}

/** "System default" first, then unique voices by name; a saved voice this window can't see stays listed. */
export function voiceOptions(voices: readonly VoiceLike[], current: string | null): readonly { readonly value: string; readonly label: string }[] {
  const byName = new Map<string, VoiceLike>();
  for (const voice of voices) if (!byName.has(voice.name)) byName.set(voice.name, voice);
  const listed = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` }));
  const missing = current && !byName.has(current) ? [{ value: current, label: `${current} (not found on this computer)` }] : [];
  return [{ value: '', label: 'System default' }, ...listed, ...missing];
}

/** Model to use after switching speech-to-text provider: its first suggestion, else keep the current one. */
export function sttModelFor(providerId: SttProviderId, current: string): string {
  return PROVIDERS.find((p) => p.id === providerId)?.sttModels[0] ?? current;
}

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}
