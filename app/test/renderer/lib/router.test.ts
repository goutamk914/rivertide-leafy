// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentRoute, HOME_ROUTE, isSameRoute, navigate, parseRoute, routePath, subscribeRoute } from '../../../src/renderer/lib/router';

describe('parseRoute', () => {
  it('parses a hash with a section', () => {
    // Arrange + Act
    const route = parseRoute('#/settings/voice');

    // Assert
    expect(route).toEqual({ name: 'settings', section: 'voice', path: '/settings/voice' });
  });

  it('accepts paths without the hash or leading slash', () => {
    expect(parseRoute('/history').name).toBe('history');
    expect(parseRoute('chat').name).toBe('chat');
  });

  it('treats empty input as home', () => {
    expect(parseRoute('')).toEqual(HOME_ROUTE);
    expect(parseRoute(undefined)).toEqual(HOME_ROUTE);
    expect(parseRoute('#/')).toEqual(HOME_ROUTE);
  });

  it('falls back to home for unknown or malformed routes', () => {
    expect(parseRoute('#/nowhere')).toEqual(HOME_ROUTE);
    expect(parseRoute('#/history/<script>')).toEqual(HOME_ROUTE);
    expect(parseRoute('#/settings/../../etc')).toEqual(HOME_ROUTE);
  });

  it('never resolves prototype members as pages', () => {
    expect(parseRoute('#/constructor')).toEqual(HOME_ROUTE);
    expect(parseRoute('#/toString/x')).toEqual(HOME_ROUTE);
    expect(parseRoute('#/__proto__')).toEqual(HOME_ROUTE);
  });

  it('matches the page name case-insensitively but keeps the section as written', () => {
    expect(parseRoute('#/History/AbC123')).toEqual({ name: 'history', section: 'AbC123', path: '/history/AbC123' });
  });

  it('ignores query strings and extra segments', () => {
    expect(parseRoute('#/notes/new?x=1').path).toBe('/notes/new');
    expect(parseRoute('#/settings/ai/extra').section).toBe('ai');
  });

  it('never gives home a section', () => {
    expect(routePath('home', 'x')).toBe('/');
    expect(routePath('insights')).toBe('/insights');
    expect(routePath('knowledge', 'graph')).toBe('/knowledge/graph');
  });

  it('compares routes by path', () => {
    expect(isSameRoute(parseRoute('/chat/a'), parseRoute('#/chat/a'))).toBe(true);
    expect(isSameRoute(parseRoute('/chat/a'), parseRoute('/chat/b'))).toBe(false);
  });
});

describe('navigate and subscribeRoute', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('pushes a hash and notifies subscribers', async () => {
    // Arrange
    const listener = vi.fn();
    const stop = subscribeRoute(listener);

    // Act
    navigate('/knowledge/graph');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(window.location.hash).toBe('#/knowledge/graph');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ name: 'knowledge', section: 'graph' }));
    expect(currentRoute().name).toBe('knowledge');
    stop();
  });

  it('replaces the entry when asked and still notifies', () => {
    // Arrange
    const listener = vi.fn();
    const stop = subscribeRoute(listener);
    const before = window.history.length;

    // Act
    navigate('/history/abc', { replace: true });

    // Assert
    expect(window.location.hash).toBe('#/history/abc');
    expect(window.history.length).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('canonicalises unknown targets to home', () => {
    navigate('/history');
    navigate('/does-not-exist', { replace: true });
    expect(window.location.hash).toBe('#/');
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const stop = subscribeRoute(listener);
    stop();
    navigate('/chat', { replace: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
