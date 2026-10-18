import { describe, expect, it } from 'vitest';
import { appleScriptString, runFile } from '../../../src/main/os/exec';

describe('runFile', () => {
  it('runs a program with an argument array (no shell interpretation)', async () => {
    const result = await runFile('/bin/echo', ['hello; rm -rf /', '$(whoami)']);
    expect(result).toEqual({ ok: true, code: 0, stdout: 'hello; rm -rf / $(whoami)\n', stderr: '', timedOut: false, error: null });
  });

  it('reports a non-zero exit code', async () => {
    const result = await runFile('/usr/bin/false', []);
    expect(result).toMatchObject({ ok: false, code: 1, timedOut: false, error: 'exited with code 1' });
  });

  it('reports a missing program', async () => {
    expect(await runFile('/definitely/not/here', [])).toMatchObject({ ok: false, error: 'program not found' });
  });

  it('kills a program that runs past its timeout', async () => {
    const result = await runFile('/bin/sleep', ['5'], { timeoutMs: 100 });
    expect(result).toMatchObject({ ok: false, timedOut: true, error: 'timed out' });
  });

  it('distinguishes an abort from a timeout', async () => {
    const controller = new AbortController();
    const pending = runFile('/bin/sleep', ['5'], { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, timedOut: false, error: 'aborted' });
  });

  it('writes input to stdin', async () => {
    expect((await runFile('/bin/cat', [], { input: 'from stdin' })).stdout).toBe('from stdin');
  });
});

describe('appleScriptString', () => {
  it('escapes quotes and backslashes', () => {
    expect(appleScriptString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
  });
});
