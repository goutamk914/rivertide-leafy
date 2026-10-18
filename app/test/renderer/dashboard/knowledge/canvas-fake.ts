/** A recording stand-in for CanvasRenderingContext2D (jsdom has no canvas). */
export interface CanvasCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface RecordingContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: CanvasCall[];
  readonly texts: () => string[];
}

export function recordingContext(): RecordingContext {
  const calls: CanvasCall[] = [];
  const props = new Map<PropertyKey, unknown>();
  const ctx = new Proxy({} as Record<PropertyKey, unknown>, {
    get: (_target, prop) => {
      if (props.has(prop)) return props.get(prop);
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args });
      };
    },
    set: (_target, prop, value) => {
      props.set(prop, value);
      return true;
    },
  });
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    texts: () => calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0])),
  };
}
