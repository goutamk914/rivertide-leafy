import { z } from 'zod';

/** Providers Rivertide can talk to. Keys live in main-only encrypted storage, never here. */
export const LLM_PROVIDER_IDS = ['anthropic', 'groq', 'openai', 'openrouter', 'ollama', 'custom'] as const;
export const STT_PROVIDER_IDS = ['groq', 'openai', 'custom', 'local'] as const;
export const LLM_ROLES = ['polish', 'answer', 'agent', 'chat', 'extract'] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];
export type LlmRole = (typeof LLM_ROLES)[number];
export type SecretId = LlmProviderId | 'stt-custom';

const roleSchema = z.object({
  providerId: z.enum(LLM_PROVIDER_IDS),
  model: z.string().min(1).max(120),
});

const accelerator = z.string().max(60);

export const SettingsSchema = z.object({
  version: z.literal(1),
  onboarded: z.boolean(),
  profile: z.object({
    name: z.string().max(80),
  }),
  appearance: z.object({
    theme: z.enum(['dark', 'light', 'system']),
    /** Multiplier for all UI text, for tired eyes. */
    textScale: z.number().min(0.9).max(1.5),
    /** Calm mode trims the dashboard to one task at a time. 'auto' follows the fog index. */
    calmMode: z.enum(['auto', 'on', 'off']),
    reduceMotion: z.enum(['system', 'on', 'off']),
  }),
  llm: z.object({
    roles: z.object({
      polish: roleSchema,
      answer: roleSchema,
      agent: roleSchema,
      chat: roleSchema,
      extract: roleSchema,
    }),
    /** Base URL overrides (ollama, custom, openrouter mirrors). */
    baseUrls: z.record(z.string(), z.string().url().max(300)),
  }),
  stt: z.object({
    providerId: z.enum(STT_PROVIDER_IDS),
    model: z.string().min(1).max(120),
    /** 'auto' or an ISO-639-1 code like 'en'. */
    language: z.string().min(2).max(8),
    customBaseUrl: z.string().max(300),
    localBinaryPath: z.string().max(500),
    localModelPath: z.string().max(500),
  }),
  voice: z.object({
    /** How keyboard triggers behave on platforms without fn hold support. */
    inputMode: z.enum(['hold', 'toggle']),
    /** Silence that ends a hands-free capture. Generous by default for slower speech. */
    endSilenceMs: z.number().int().min(1000).max(5000),
    maxDurationSec: z.number().int().min(30).max(600),
    microphoneId: z.string().max(200).nullable(),
    sounds: z.boolean(),
    speakResponses: z.boolean(),
    voiceName: z.string().max(120).nullable(),
    speechRate: z.number().min(0.6).max(1.4),
    polish: z.object({
      enabled: z.boolean(),
      removeFillers: z.boolean(),
      fixRepetitions: z.boolean(),
      resolveSelfCorrections: z.boolean(),
      autoFormat: z.boolean(),
      tone: z.enum(['natural', 'professional', 'casual']),
    }),
    output: z.enum(['paste', 'type', 'clipboard']),
    alsoCopy: z.boolean(),
    keepRecordings: z.boolean(),
    /** Include the frontmost app's name in the polish prompt (tone hints). */
    useAppContext: z.boolean(),
  }),
  hotkeys: z.object({
    useFn: z.boolean(),
    palette: accelerator,
    command: accelerator,
    dictate: accelerator,
  }),
  clap: z.object({
    enabled: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']),
    action: z.enum(['command', 'palette']),
  }),
  /** "Hey Leafy": fully on-device; it only summons Leafy and starts a voice command. */
  wakeWord: z.object({
    enabled: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']),
  }),
  leafy: z.object({
    visible: z.boolean(),
    size: z.enum(['small', 'medium', 'large']),
    sleepAtNight: z.boolean(),
    tips: z.boolean(),
  }),
  agent: z.object({
    /** Per-tool override: 'always' runs without asking, 'ask' confirms, 'never' blocks. */
    toolPolicy: z.record(z.string(), z.enum(['always', 'ask', 'never'])),
    allowNetworkTools: z.boolean(),
  }),
  knowledge: z.object({
    autoExtract: z.boolean(),
    learnDictionary: z.boolean(),
  }),
  insights: z.object({
    dynamicsEnabled: z.boolean(),
  }),
  privacy: z.object({
    historyEnabled: z.boolean(),
    /** 0 = keep forever. */
    retentionDays: z.number().int().min(0).max(3650),
  }),
  system: z.object({
    launchAtLogin: z.boolean(),
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_MODEL: Record<LlmProviderId, string> = {
  anthropic: 'claude-opus-5-5',
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-5-mini',
  openrouter: 'openai/gpt-oss-120b',
  ollama: 'qwen3:8b',
  custom: 'default',
};

const role = (providerId: LlmProviderId) => ({ providerId, model: DEFAULT_MODEL[providerId] });

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  onboarded: false,
  profile: { name: '' },
  appearance: { theme: 'dark', textScale: 1, calmMode: 'auto', reduceMotion: 'system' },
  llm: {
    roles: {
      polish: role('anthropic'),
      answer: role('anthropic'),
      agent: role('anthropic'),
      chat: role('anthropic'),
      extract: role('anthropic'),
    },
    baseUrls: {},
  },
  stt: {
    providerId: 'groq',
    model: 'whisper-large-v3-turbo',
    language: 'auto',
    customBaseUrl: '',
    localBinaryPath: '',
    localModelPath: '',
  },
  voice: {
    inputMode: 'hold',
    endSilenceMs: 2200,
    maxDurationSec: 600,
    microphoneId: null,
    sounds: true,
    speakResponses: true,
    voiceName: null,
    speechRate: 0.95,
    polish: {
      enabled: true,
      removeFillers: true,
      fixRepetitions: true,
      resolveSelfCorrections: true,
      autoFormat: true,
      tone: 'natural',
    },
    output: 'paste',
    alsoCopy: false,
    keepRecordings: false,
    useAppContext: true,
  },
  hotkeys: {
    useFn: true,
    palette: 'CommandOrControl+Shift+Space',
    command: 'CommandOrControl+Shift+L',
    dictate: 'CommandOrControl+Shift+D',
  },
  clap: { enabled: false, sensitivity: 'medium', action: 'command' },
  wakeWord: { enabled: false, sensitivity: 'medium' },
  leafy: { visible: true, size: 'medium', sleepAtNight: true, tips: true },
  agent: { toolPolicy: {}, allowNetworkTools: true },
  knowledge: { autoExtract: true, learnDictionary: true },
  insights: { dynamicsEnabled: true },
  privacy: { historyEnabled: true, retentionDays: 0 },
  system: { launchAtLogin: false },
};

/** Deep-partial patch shape accepted by `settings:update`. Arrays and records are replaced wholesale. */
export type SettingsPatch = DeepPartial<Settings>;
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Returns a new settings object with `patch` merged in. Nested objects merge; arrays,
 * records like `toolPolicy`/`baseUrls` and primitives replace. The result is validated —
 * an invalid patch throws a ZodError and the caller's settings stay untouched.
 */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const replaceWholesale = new Set(['toolPolicy', 'baseUrls']);
  const merge = (base: unknown, change: unknown, key: string | null): unknown => {
    if (!isPlainObject(change) || !isPlainObject(base) || (key !== null && replaceWholesale.has(key))) {
      return change === undefined ? base : change;
    }
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(change)) {
      out[k] = merge(base[k], v, k);
    }
    return out;
  };
  return SettingsSchema.parse(merge(current, patch, null));
}

/**
 * Loads persisted settings defensively: unknown keys are dropped, missing or invalid
 * sections fall back to defaults section by section, so one bad value never wipes the rest.
 */
export function migrateSettings(raw: unknown): Settings {
  if (!isPlainObject(raw)) return DEFAULT_SETTINGS;
  const shape = SettingsSchema.shape;
  const result: Record<string, unknown> = { version: 1 };
  for (const key of Object.keys(shape) as (keyof Settings)[]) {
    if (key === 'version') continue;
    const fallback = DEFAULT_SETTINGS[key];
    const candidate = isPlainObject(fallback) && isPlainObject(raw[key])
      ? { ...fallback, ...(raw[key] as Record<string, unknown>) }
      : raw[key] ?? fallback;
    const parsed = shape[key].safeParse(candidate);
    result[key] = parsed.success ? parsed.data : fallback;
  }
  return SettingsSchema.parse(result);
}

/** Provider catalogue for settings UI and onboarding. Model lists are suggestions; any id can be typed. */
export interface ProviderInfo {
  readonly id: LlmProviderId | SttProviderId;
  readonly name: string;
  readonly llm: boolean;
  readonly stt: boolean;
  readonly needsKey: boolean;
  readonly defaultBaseUrl: string | null;
  readonly keyUrl: string | null;
  readonly llmModels: readonly string[];
  readonly sttModels: readonly string[];
  readonly note: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'anthropic', name: 'Claude (Anthropic)', llm: true, stt: false, needsKey: true,
    defaultBaseUrl: null, keyUrl: 'https://console.anthropic.com/settings/keys',
    llmModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], sttModels: [],
    note: 'Most capable. Best for Leafy commands, chat and answers.',
  },
  {
    id: 'groq', name: 'Groq', llm: true, stt: true, needsKey: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',
    llmModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    sttModels: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    note: 'Fastest speech-to-text. Has a free tier.',
  },
  {
    id: 'openai', name: 'OpenAI', llm: true, stt: true, needsKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys',
    llmModels: ['gpt-5-mini', 'gpt-5'], sttModels: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    note: 'Accurate transcription; general-purpose models.',
  },
  {
    id: 'openrouter', name: 'OpenRouter', llm: true, stt: false, needsKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    llmModels: ['openai/gpt-oss-120b'], sttModels: [],
    note: 'One key for many model makers.',
  },
  {
    id: 'ollama', name: 'Ollama (on this computer)', llm: true, stt: false, needsKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1', keyUrl: 'https://ollama.com/download',
    llmModels: ['qwen3:8b', 'gpt-oss:20b', 'llama3.2'], sttModels: [],
    note: 'Private: text never leaves your computer. Needs a capable machine.',
  },
  {
    id: 'custom', name: 'Custom (OpenAI-compatible)', llm: true, stt: true, needsKey: true,
    defaultBaseUrl: null, keyUrl: null, llmModels: [], sttModels: [],
    note: 'Any server that speaks the OpenAI API.',
  },
  {
    id: 'local', name: 'whisper.cpp (on this computer)', llm: false, stt: true, needsKey: false,
    defaultBaseUrl: null, keyUrl: 'https://github.com/ggml-org/whisper.cpp',
    llmModels: [], sttModels: ['local'],
    note: 'Private speech-to-text. Install whisper-cli and pick a model file.',
  },
];
