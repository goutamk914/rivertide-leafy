/**
 * Renderer hardening:
 *  - `app://rivertide/<page>.html` serves the built renderer from `dist/` (no file:// access),
 *    with path-traversal protection and a strict Content-Security-Policy header.
 *  - In development the same CSP (plus the Vite origin, HMR websocket and inline preamble) is
 *    injected into dev-server responses.
 *  - Only our engine window may use the microphone; every other permission is denied.
 *  - No new windows, no webviews, no navigation away from our origin (http(s) links open in the browser).
 */
import { app, protocol, shell, type Session, type WebContents } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { Logger, WindowKind } from './services';
import { APP_HOST, APP_ORIGIN, APP_SCHEME } from './windows/common';

const PROD_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
] as const;

export const PROD_CSP = PROD_CSP_DIRECTIVES.join('; ');

/** Dev CSP: also allows the Vite origin, its HMR websocket and React Refresh's inline preamble. */
export function devCsp(devServerUrl: string): string {
  const origin = originOf(devServerUrl) ?? devServerUrl;
  const ws = origin.replace(/^http/, 'ws');
  return PROD_CSP_DIRECTIVES.map((directive) => {
    if (directive.startsWith('script-src')) return `script-src 'self' 'unsafe-inline' ${origin}`;
    if (directive.startsWith('connect-src')) return `connect-src 'self' ${origin} ${ws}`;
    return directive;
  }).join('; ');
}

/** `scheme://host[:port]` of a URL (works for custom schemes, unlike URL.origin). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && originOf(url) !== null;
}

export function isSameOrigin(url: string, allowedOrigin: string): boolean {
  const origin = originOf(url);
  return origin !== null && origin.toLowerCase() === allowedOrigin.toLowerCase();
}

// ── app:// protocol ──────────────────────────────────────────────────────────────────────────

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  ]);
}

/** Maps an app:// URL to a file inside `distDir`, or null if it is foreign or escapes the folder. */
export function resolveAppFile(distDir: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relativePath = pathname.replace(/^\/+/, '') || 'main.html';
  const root = resolve(distDir);
  const full = resolve(root, relativePath);
  const inside = relative(root, full);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  return full;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeTypeFor(file: string): string {
  return MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const textResponse = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * Serves `distDir` over app://rivertide/ (after `app` is ready). `resolveAppFile` blocks traversal;
 * `realpath` is deliberately not used because it is unreliable inside packaged asar archives.
 */
export function installAppProtocol(distDir: string, logger: Logger): void {
  const log = logger.child('protocol');
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Method not allowed');
    const file = resolveAppFile(distDir, request.url);
    if (!file) return textResponse(404, 'Not found');
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': mimeTypeFor(file),
          'Content-Security-Policy': PROD_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') return textResponse(404, 'Not found');
      log.error('could not serve file', { url: request.url, error });
      return textResponse(500, 'Could not load this part of Rivertide');
    }
  });
}

/** Adds the dev CSP to every response from the Vite dev server. */
export function installDevCsp(session: Session, devServerUrl: string): void {
  const csp = devCsp(devServerUrl);
  const origin = originOf(devServerUrl) ?? devServerUrl;
  session.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(([name]) => name.toLowerCase() !== 'content-security-policy'),
    );
    callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [csp] } });
  });
}

// ── Permissions ──────────────────────────────────────────────────────────────────────────────

export interface PermissionQuery {
  readonly permission: string;
  readonly kind: WindowKind | null;
  readonly origin: string | null;
  readonly allowedOrigin: string;
  readonly mediaTypes: readonly string[];
  /** Permission checks (not prompts) may report an 'unknown' media type for device enumeration. */
  readonly isCheck: boolean;
}

/** Microphone for our engine window on our origin; nothing else, for anyone. */
export function shouldGrantPermission(query: PermissionQuery): boolean {
  if (query.permission !== 'media' || query.kind !== 'engine') return false;
  if (!query.origin || !isSameOrigin(query.origin, query.allowedOrigin)) return false;
  const allowedTypes = query.isCheck ? ['audio', 'unknown'] : ['audio'];
  return query.mediaTypes.every((type) => allowedTypes.includes(type));
}

export function installPermissionHandlers(
  session: Session,
  kindOf: (webContentsId: number) => WindowKind | null,
  allowedOrigin: string,
  logger: Logger,
): void {
  const log = logger.child('permissions');
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const kind = kindOf(webContents.id);
    const granted = shouldGrantPermission({
      permission, kind, origin: details.requestingUrl ?? null, allowedOrigin, mediaTypes, isCheck: false,
    });
    if (!granted) log.warn('permission denied', { permission, kind });
    callback(granted);
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    shouldGrantPermission({
      permission,
      kind: webContents ? kindOf(webContents.id) : null,
      origin: requestingOrigin || details.requestingUrl || null,
      allowedOrigin,
      mediaTypes: details.mediaType ? [details.mediaType] : [],
      isCheck: true,
    }));
  session.setDevicePermissionHandler(() => false);
}

// ── Navigation ───────────────────────────────────────────────────────────────────────────────

function openExternally(url: string, log: Logger): void {
  if (!isHttpUrl(url)) return;
  shell.openExternal(url).catch((error: unknown) => log.error('could not open link', { error }));
}

function guardContents(contents: WebContents, allowedOrigin: string, log: Logger): void {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url, log);
    return { action: 'deny' };
  });
  const guardNavigation = (event: { preventDefault(): void; url: string }): void => {
    if (isSameOrigin(event.url, allowedOrigin)) return;
    event.preventDefault();
    log.warn('blocked navigation', { origin: originOf(event.url) });
    openExternally(event.url, log);
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
}

/** Applies to every webContents Rivertide ever creates. Call before creating windows. */
export function installNavigationGuards(allowedOrigin: string, logger: Logger): void {
  const log = logger.child('navigation');
  app.on('web-contents-created', (_event, contents) => guardContents(contents, allowedOrigin, log));
}

/** The origin our pages load from: the dev server in development, app://rivertide otherwise. */
export function appOrigin(devServerUrl: string | null): string {
  return (devServerUrl && originOf(devServerUrl)) || APP_ORIGIN;
}
