import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, protocol: {}, shell: {} }));

import {
  appOrigin, devCsp, isHttpUrl, isSameOrigin, mimeTypeFor, originOf, PROD_CSP, resolveAppFile, shouldGrantPermission,
} from '../../../src/main/security';
import { pageUrl } from '../../../src/main/windows/common';

const DIST = '/opt/rivertide/dist';

describe('app:// file resolution', () => {
  it('maps pages and assets inside dist', () => {
    expect(resolveAppFile(DIST, 'app://rivertide/main.html')).toBe(`${DIST}/main.html`);
    expect(resolveAppFile(DIST, 'app://rivertide/assets/index-abc.js')).toBe(`${DIST}/assets/index-abc.js`);
    expect(resolveAppFile(DIST, 'app://rivertide/')).toBe(`${DIST}/main.html`);
    expect(resolveAppFile(DIST, 'app://rivertide/fonts/Inter%20Var.woff2')).toBe(`${DIST}/fonts/Inter Var.woff2`);
  });

  it('rejects traversal, other hosts, other schemes and malformed input', () => {
    // The URL parser folds ".." and "%2e%2e" segments, so these stay inside dist.
    expect(resolveAppFile(DIST, 'app://rivertide/../secrets.json')).toBe(`${DIST}/secrets.json`);
    expect(resolveAppFile(DIST, 'app://rivertide/%2e%2e/%2e%2e/etc/passwd')).toBe(`${DIST}/etc/passwd`);
    // Encoded slashes are not folded by the parser; the containment check catches them.
    expect(resolveAppFile(DIST, 'app://rivertide/assets/%2e%2e%2f%2e%2e%2fsecret')).toBeNull();
    expect(resolveAppFile(DIST, 'app://rivertide/a%00b.html')).toBeNull();
    expect(resolveAppFile(DIST, 'app://rivertide/%E0%A4%A')).toBeNull();
    expect(resolveAppFile(DIST, 'app://evil/main.html')).toBeNull();
    expect(resolveAppFile(DIST, 'file:///opt/rivertide/dist/main.html')).toBeNull();
    expect(resolveAppFile(DIST, 'not a url')).toBeNull();
  });
});

describe('content security policy', () => {
  it('production CSP blocks inline scripts and network access', () => {
    expect(PROD_CSP).toContain("script-src 'self';");
    expect(PROD_CSP).toContain("connect-src 'self';");
    expect(PROD_CSP).toContain("object-src 'none'");
    expect(PROD_CSP).toContain("frame-ancestors 'none'");
    expect(PROD_CSP).toContain('media-src \'self\' blob: mediastream:');
  });

  it('dev CSP adds only the Vite origin, its websocket and the inline preamble', () => {
    // Act
    const csp = devCsp('http://localhost:5317');

    // Assert
    expect(csp).toContain("script-src 'self' 'unsafe-inline' http://localhost:5317;");
    expect(csp).toContain("connect-src 'self' http://localhost:5317 ws://localhost:5317;");
    expect(csp).toContain("object-src 'none'");
  });
});

describe('origins and URLs', () => {
  it('computes origins for custom and http schemes', () => {
    expect(originOf('app://rivertide/main.html')).toBe('app://rivertide');
    expect(originOf('http://localhost:5317/palette.html')).toBe('http://localhost:5317');
    expect(originOf('nonsense')).toBeNull();
    expect(appOrigin(null)).toBe('app://rivertide');
    expect(appOrigin('http://localhost:5317')).toBe('http://localhost:5317');
  });

  it('compares origins strictly', () => {
    expect(isSameOrigin('app://rivertide/x.html', 'app://rivertide')).toBe(true);
    expect(isSameOrigin('app://rivertide.evil/x.html', 'app://rivertide')).toBe(false);
    expect(isSameOrigin('http://localhost:5318/', 'http://localhost:5317')).toBe(false);
  });

  it('recognises only http(s) links as external', () => {
    expect(isHttpUrl('https://codethecure.org')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('builds page URLs for production and development', () => {
    expect(pageUrl('palette', null)).toBe('app://rivertide/palette.html');
    expect(pageUrl('main', 'http://localhost:5317/')).toBe('http://localhost:5317/main.html');
  });

  it('serves the right content types', () => {
    expect(mimeTypeFor('/x/main.html')).toBe('text/html; charset=utf-8');
    expect(mimeTypeFor('/x/a.JS')).toBe('text/javascript; charset=utf-8');
    expect(mimeTypeFor('/x/font.woff2')).toBe('font/woff2');
    expect(mimeTypeFor('/x/unknown.bin')).toBe('application/octet-stream');
  });
});

describe('permission policy', () => {
  const base = { permission: 'media', kind: 'engine' as const, origin: 'app://rivertide', allowedOrigin: 'app://rivertide', mediaTypes: ['audio'], isCheck: false };

  it('grants audio to the engine window on our origin', () => {
    expect(shouldGrantPermission(base)).toBe(true);
  });

  it('denies other windows, other origins, video and other permissions', () => {
    expect(shouldGrantPermission({ ...base, kind: 'dashboard' })).toBe(false);
    expect(shouldGrantPermission({ ...base, kind: null })).toBe(false);
    expect(shouldGrantPermission({ ...base, origin: 'https://evil.example' })).toBe(false);
    expect(shouldGrantPermission({ ...base, origin: null })).toBe(false);
    expect(shouldGrantPermission({ ...base, mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(shouldGrantPermission({ ...base, permission: 'notifications' })).toBe(false);
    expect(shouldGrantPermission({ ...base, permission: 'clipboard-read' })).toBe(false);
  });

  it('allows the unknown media type only for permission checks', () => {
    expect(shouldGrantPermission({ ...base, mediaTypes: ['unknown'], isCheck: true })).toBe(true);
    expect(shouldGrantPermission({ ...base, mediaTypes: ['unknown'], isCheck: false })).toBe(false);
  });
});
