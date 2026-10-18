import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, maskSecrets, redact } from '../../../src/main/logger';

const NOW = new Date('2026-10-15T14:03:00.000Z');

describe('logger', () => {
  let dir: string;
  let stderr: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rivertide-log-'));
    stderr = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const lines = (name = 'rivertide.log') =>
    readFileSync(join(dir, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  it('writes one JSON object per line with time, level, scope and message', () => {
    // Arrange
    const logger = createLogger({ file: join(dir, 'rivertide.log'), isDev: false, now: () => NOW, stderr: (l) => stderr.push(l) });

    // Act
    logger.child('voice').child('stt').info('transcribed', { ms: 412 });

    // Assert
    expect(lines()).toEqual([{ t: NOW.toISOString(), level: 'info', scope: 'voice:stt', msg: 'transcribed', ms: 412 }]);
    expect(stderr).toEqual([]);
  });

  it('redacts credential-like keys at any depth and masks key-shaped strings', () => {
    // Arrange
    const logger = createLogger({ file: join(dir, 'rivertide.log'), isDev: false, now: () => NOW });

    // Act
    logger.warn('request failed', {
      apiKey: 'sk-ant-abcdefghijklmnop',
      nested: { Authorization: 'Bearer abc', accessToken: 'x', password: 'p', okay: 'visible' },
      note: 'used key sk-ant-api03-ZZZZZZZZZZZZ in header',
    });

    // Assert
    const [record] = lines();
    expect(record?.apiKey).toBe('[redacted]');
    expect(record?.nested).toEqual({ Authorization: '[redacted]', accessToken: '[redacted]', password: '[redacted]', okay: 'visible' });
    expect(record?.note).toBe('used key [redacted] in header');
    expect(JSON.stringify(record)).not.toContain('sk-ant');
  });

  it('skips debug lines in production but keeps them in development', () => {
    // Arrange
    const prod = createLogger({ file: join(dir, 'prod.log'), isDev: false, stderr: () => undefined });
    const dev = createLogger({ file: join(dir, 'dev.log'), isDev: true, stderr: (l) => stderr.push(l) });

    // Act
    prod.debug('hidden');
    dev.debug('shown');

    // Assert
    expect(existsSync(join(dir, 'prod.log'))).toBe(false);
    expect(lines('dev.log')[0]?.msg).toBe('shown');
    expect(stderr[0]).toContain('DEBUG [app] shown');
  });

  it('rotates at the size limit and keeps exactly one old file', () => {
    // Arrange
    const logger = createLogger({ file: join(dir, 'rivertide.log'), isDev: false, maxBytes: 200 });

    // Act
    for (let i = 0; i < 12; i += 1) logger.info(`line ${i}`, { padding: 'x'.repeat(40) });

    // Assert
    expect(existsSync(join(dir, 'rivertide.1.log'))).toBe(true);
    expect(existsSync(join(dir, 'rivertide.2.log'))).toBe(false);
    expect(readFileSync(join(dir, 'rivertide.log'), 'utf8').length).toBeLessThanOrEqual(200);
    expect(lines().at(-1)?.msg).toBe('line 11');
  });

  it('never throws when the log file cannot be written', () => {
    // Arrange
    const logger = createLogger({ file: join(dir, 'missing', '\0bad', 'x.log'), isDev: false, stderr: (l) => stderr.push(l) });

    // Act / Assert
    expect(() => logger.error('still fine')).not.toThrow();
    expect(stderr.join('')).toContain('cannot write');
  });

  it('meta cannot overwrite the core fields', () => {
    // Arrange
    const logger = createLogger({ file: join(dir, 'rivertide.log'), isDev: false, now: () => NOW });

    // Act
    logger.info('real message', { msg: 'fake', level: 'error' });

    // Assert
    expect(lines()[0]).toMatchObject({ msg: 'real message', level: 'info' });
  });
});

describe('redact', () => {
  it('flattens errors, summarises bytes and cuts cycles', () => {
    // Arrange
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    // Act
    const out = redact({ error: new TypeError('boom'), wav: new Uint8Array(16), cyclic }) as Record<string, any>; // test-only inspection

    // Assert
    expect(out.error).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect(out.wav).toBe('[16 bytes]');
    expect(out.cyclic.self).toBe('[circular]');
  });

  it('masks common provider key formats in free text', () => {
    expect(maskSecrets('groq gsk_abcdefghijklmnopqrstu and sk-proj-abcdefghijklmnopqrst')).toBe('groq [redacted] and [redacted]');
  });
});
