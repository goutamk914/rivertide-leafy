/**
 * API keys (`ctx.secrets`): encrypted with Electron `safeStorage` (macOS Keychain-backed) and stored
 * as base64 in `secrets.json`. Plain text is never written: if OS encryption is unavailable the key
 * is refused. Values are never logged and never sent to renderers (only `{ set: boolean }`).
 */
import { safeStorage } from 'electron';
import { z } from 'zod';
import type { SecretStatus } from '../shared/ipc';
import { LLM_PROVIDER_IDS, type SecretId } from '../shared/settings';
import type { AppContext, JsonStore, SecretsService } from './services';

export const SECRETS_STORE = 'secrets';
export const SECRET_IDS: readonly SecretId[] = [...LLM_PROVIDER_IDS, 'stt-custom'];
export const ENCRYPTION_UNAVAILABLE_MESSAGE = "Secure storage isn't available on this computer, so the key wasn't saved.";
const MAX_ENCRYPTED_LENGTH = 20_000;

/** The parts of Electron's `safeStorage` this module uses (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

type SecretsFile = Readonly<Partial<Record<SecretId, string>>>;

const SECRET_ID_SET: ReadonlySet<string> = new Set(SECRET_IDS);

/** Keeps only known ids with string values; anything else in the file is dropped. */
export function parseSecretsFile(raw: unknown): SecretsFile {
  const parsed = z.record(z.string(), z.unknown()).parse(raw);
  const entries = Object.entries(parsed).filter(
    ([id, value]) => SECRET_ID_SET.has(id) && typeof value === 'string' && value.length > 0 && value.length <= MAX_ENCRYPTED_LENGTH,
  );
  return Object.fromEntries(entries) as SecretsFile;
}

export function createSecretsService(ctx: AppContext, safe: SafeStorageLike = safeStorage): SecretsService {
  let store: JsonStore<SecretsFile> | null = null;
  const secretsStore = (): JsonStore<SecretsFile> => {
    store ??= ctx.openStore<SecretsFile>(SECRETS_STORE, { defaults: {}, validate: parseSecretsFile });
    return store;
  };
  const log = () => ctx.logger.child('secrets');

  const isEncryptionAvailable = (): boolean => {
    try {
      if (!safe.isEncryptionAvailable()) return false;
      // On Linux without a keyring Chromium falls back to an obfuscated plain-text backend.
      return !(ctx.platform === 'linux' && safe.getSelectedStorageBackend?.() === 'basic_text');
    } catch (error) {
      log().warn('could not check secure storage', { error });
      return false;
    }
  };

  const persistSoon = (): void => {
    secretsStore().flush().catch((error: unknown) => log().error('could not save secrets file', { error }));
  };

  const status = (): SecretStatus => {
    const current = secretsStore().read();
    return Object.fromEntries(SECRET_IDS.map((id) => [id, { set: typeof current[id] === 'string' }])) as SecretStatus;
  };

  return {
    isEncryptionAvailable,
    status,
    get(id) {
      const encoded = secretsStore().read()[id];
      if (!encoded) return null;
      if (!isEncryptionAvailable()) {
        log().warn('secure storage unavailable; cannot read saved key', { provider: id });
        return null;
      }
      try {
        return safe.decryptString(Buffer.from(encoded, 'base64'));
      } catch (error) {
        log().warn('could not decrypt saved key', { provider: id, error });
        return null;
      }
    },
    set(id, value) {
      if (!SECRET_ID_SET.has(id)) throw new Error('That provider is not one Rivertide knows about.');
      const trimmed = value.trim();
      if (!trimmed) throw new Error('The key is empty. Paste the whole key and try again.');
      if (!isEncryptionAvailable()) throw new Error(ENCRYPTION_UNAVAILABLE_MESSAGE);
      const encoded = safe.encryptString(trimmed).toString('base64');
      secretsStore().update((current) => ({ ...current, [id]: encoded }));
      persistSoon();
      log().info('key saved', { provider: id });
      return status();
    },
    clear(id) {
      secretsStore().update((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)) as SecretsFile);
      persistSoon();
      log().info('key removed', { provider: id });
      return status();
    },
  };
}
