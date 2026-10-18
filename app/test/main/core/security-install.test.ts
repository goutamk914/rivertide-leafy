import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (...args: any[]) => unknown; // test-only: captured Electron callbacks

const electron = vi.hoisted(() => {
  const appListeners = new Map<string, (...args: any[]) => unknown>(); // test-only capture
  return {
    appListeners,
    protocolHandlers: new Map<string, (request: Request) => Promise<Response>>(),
    app: { on: (event: string, listener: (...args: any[]) => unknown) => appListeners.set(event, listener) }, // test-only
    protocol: {
      handle: (scheme: string, handler: (request: Request) => Promise<Response>) => electron.protocolHandlers.set(scheme, handler),
    },
    shell: { openExternal: vi.fn(async () => undefined) },
  };
});
vi.mock('electron', () => electron);

import type { Session } from 'electron';
import {
  installAppProtocol, installDevCsp, installNavigationGuards, installPermissionHandlers, PROD_CSP,
} from '../../../src/main/security';
import { memoryLogger } from './fakes';

describe('app:// protocol handler', () => {
  let dist: string;
  let handler: (request: Request) => Promise<Response>;

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'rivertide-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'main.html'), '<!doctype html><title>Rivertide</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.info(1)');
    installAppProtocol(dist, memoryLogger());
    handler = electron.protocolHandlers.get('app')!;
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('serves pages with the strict CSP, the right type and nosniff', async () => {
    // Act
    const response = await handler(new Request('app://rivertide/main.html'));

    // Assert
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Rivertide</title>');
    expect(response.headers.get('content-security-policy')).toBe(PROD_CSP);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves assets and returns 404 for missing files, folders and escapes', async () => {
    expect((await handler(new Request('app://rivertide/assets/app.js'))).headers.get('content-type')).toContain('javascript');
    expect((await handler(new Request('app://rivertide/missing.html'))).status).toBe(404);
    expect((await handler(new Request('app://rivertide/assets'))).status).toBe(404);
    expect((await handler(new Request('app://rivertide/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd'))).status).toBe(404);
    expect((await handler(new Request('app://other/main.html'))).status).toBe(404);
  });

  it('refuses methods other than GET and HEAD', async () => {
    expect((await handler(new Request('app://rivertide/main.html', { method: 'POST', body: 'x' }))).status).toBe(405);
  });
});

function fakeSession() {
  const captured: { request?: Listener; check?: Listener; device?: Listener; headers?: Listener; filter?: unknown } = {};
  const session = {
    setPermissionRequestHandler: (fn: Listener) => { captured.request = fn; },
    setPermissionCheckHandler: (fn: Listener) => { captured.check = fn; },
    setDevicePermissionHandler: (fn: Listener) => { captured.device = fn; },
    webRequest: { onHeadersReceived: (filter: unknown, fn: Listener) => { captured.filter = filter; captured.headers = fn; } },
  };
  return { session: session as unknown as Session, captured };
}

describe('permission handlers', () => {
  const kindOf = (id: number) => ({ 1: 'engine', 2: 'dashboard' } as const)[id as 1 | 2] ?? null;

  it('grants the microphone to the engine only and denies devices', () => {
    // Arrange
    const { session, captured } = fakeSession();
    installPermissionHandlers(session, kindOf, 'app://rivertide', memoryLogger());
    const decide = (id: number, permission: string, mediaTypes: string[]) => {
      const callback = vi.fn();
      captured.request?.({ id }, permission, callback, { requestingUrl: 'app://rivertide/engine.html', mediaTypes });
      return callback.mock.calls[0]?.[0];
    };

    // Act / Assert
    expect(decide(1, 'media', ['audio'])).toBe(true);
    expect(decide(2, 'media', ['audio'])).toBe(false);
    expect(decide(1, 'media', ['video'])).toBe(false);
    expect(decide(1, 'geolocation', [])).toBe(false);
    expect(captured.check?.({ id: 1 }, 'media', 'app://rivertide', { mediaType: 'audio' })).toBe(true);
    expect(captured.check?.(null, 'media', 'app://rivertide', {})).toBe(false);
    expect(captured.device?.()).toBe(false);
  });
});

describe('dev CSP injection', () => {
  it('replaces any CSP header on dev-server responses with the dev policy', () => {
    // Arrange
    const { session, captured } = fakeSession();
    installDevCsp(session, 'http://localhost:5317');
    const callback = vi.fn();

    // Act
    captured.headers?.({ responseHeaders: { 'content-security-policy': ['x'], 'Content-Type': ['text/html'] } }, callback);

    // Assert
    expect(captured.filter).toEqual({ urls: ['http://localhost:5317/*'] });
    const headers = callback.mock.calls[0]?.[0].responseHeaders as Record<string, string[]>;
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['Content-Security-Policy']?.[0]).toContain('ws://localhost:5317');
    expect(headers['Content-Type']).toEqual(['text/html']);
  });
});

describe('navigation guards', () => {
  it('denies new windows, webviews and navigation away from our origin; web links open in the browser', () => {
    // Arrange
    installNavigationGuards('app://rivertide', memoryLogger());
    const handlers = new Map<string, Listener>();
    let openHandler: Listener = () => undefined;
    const contents = {
      on: (event: string, fn: Listener) => handlers.set(event, fn),
      setWindowOpenHandler: (fn: Listener) => { openHandler = fn; },
    };
    electron.appListeners.get('web-contents-created')?.({}, contents);
    const navigate = (url: string) => {
      const event = { url, preventDefault: vi.fn() };
      handlers.get('will-navigate')?.(event);
      return event.preventDefault.mock.calls.length > 0;
    };

    // Act
    const opened = openHandler({ url: 'https://codethecure.org' });
    const webview = { preventDefault: vi.fn() };
    handlers.get('will-attach-webview')?.(webview);

    // Assert
    expect(opened).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://codethecure.org');
    expect(webview.preventDefault).toHaveBeenCalled();
    expect(navigate('app://rivertide/palette.html')).toBe(false);
    expect(navigate('https://evil.example/')).toBe(true);
    expect(navigate('file:///etc/passwd')).toBe(true);
    expect(handlers.has('will-redirect')).toBe(true);
  });
});
