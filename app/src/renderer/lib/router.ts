/**
 * Tiny hash router for the dashboard window. Routes look like `#/history` or `#/settings/voice`.
 * Pure parsing lives in `parseRoute` (unit-tested); the window helpers only touch `location.hash`.
 */

export const ROUTE_NAMES = [
  'home',
  'history',
  'chat',
  'knowledge',
  'documents',
  'notes',
  'insights',
  'settings',
  'onboarding',
] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

export interface Route {
  readonly name: RouteName;
  /** Second path segment, e.g. `voice` in `/settings/voice`. */
  readonly section: string | null;
  /** Canonical path, always starting with `/`. */
  readonly path: string;
}

const PATH_PATTERN = /^\/[a-z0-9/-]*$/i;
const SEGMENT_TO_NAME: Readonly<Record<string, RouteName>> = {
  '': 'home',
  history: 'history',
  chat: 'chat',
  knowledge: 'knowledge',
  documents: 'documents',
  notes: 'notes',
  insights: 'insights',
  settings: 'settings',
  onboarding: 'onboarding',
};

export const HOME_ROUTE: Route = { name: 'home', section: null, path: '/' };

/** Builds the canonical path for a route name (+ optional section). */
export function routePath(name: RouteName, section?: string | null): string {
  const base = name === 'home' ? '/' : `/${name}`;
  return section && name !== 'home' ? `${base}/${section}` : base;
}

/**
 * Parses `#/settings/voice`, `/settings/voice` or `settings/voice` into a route.
 * Anything unknown or malformed falls back to Home, so a bad link never strands the user.
 */
export function parseRoute(input: string | null | undefined): Route {
  const raw = (input ?? '').trim().replace(/^#/, '').split(/[?#]/)[0] ?? '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (!PATH_PATTERN.test(path)) return HOME_ROUTE;
  const segments = path.split('/').filter(Boolean);
  const first = (segments[0] ?? '').toLowerCase();
  // Own keys only, so "#/constructor" or "#/toString" can never resolve to a prototype member.
  if (!Object.hasOwn(SEGMENT_TO_NAME, first)) return HOME_ROUTE;
  const name = SEGMENT_TO_NAME[first] as RouteName;
  const section = name === 'home' ? null : segments[1] ?? null;
  return { name, section, path: routePath(name, section) };
}

export function isSameRoute(a: Route, b: Route): boolean {
  return a.path === b.path;
}

/** The route currently in the address bar (Home outside a browser). */
export function currentRoute(): Route {
  if (typeof window === 'undefined') return HOME_ROUTE;
  return parseRoute(window.location.hash);
}

/** Moves to `path`. `replace` swaps the current history entry instead of pushing one. */
export function navigate(path: string, options: { readonly replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const target = parseRoute(path);
  const hash = `#${target.path}`;
  if (window.location.hash === hash) return;
  if (options.replace) {
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = hash;
}

/** Calls `listener` whenever the hash route changes. Returns the unsubscribe function. */
export function subscribeRoute(listener: (route: Route) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handle = () => listener(currentRoute());
  window.addEventListener('hashchange', handle);
  return () => window.removeEventListener('hashchange', handle);
}
