/**
 * zod → provider JSON Schema. Structured tool use supports a subset of JSON Schema, so numeric and
 * length constraints are stripped here (zod still enforces them client-side) and every object gets
 * `additionalProperties: false`.
 */
import { z } from 'zod';

const UNSUPPORTED_KEYS: ReadonlySet<string> = new Set([
  '$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'default', 'uniqueItems',
]);
const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

type Json = unknown;

function sanitize(node: Json): Json {
  if (Array.isArray(node)) return node.map(sanitize);
  if (typeof node !== 'object' || node === null) return node;
  const entries = Object.entries(node as Record<string, Json>)
    .filter(([key, value]) => !UNSUPPORTED_KEYS.has(key) && !(key === 'format' && !SUPPORTED_FORMATS.has(String(value))))
    .map(([key, value]): [string, Json] => {
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        return [key, Object.fromEntries(Object.entries(value as Record<string, Json>).map(([name, child]) => [name, sanitize(child)]))];
      }
      return [key, sanitize(value)];
    });
  const out = Object.fromEntries(entries) as Record<string, Json>;
  return out.type === 'object' ? { ...out, additionalProperties: false, properties: out.properties ?? {} } : out;
}

export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return sanitize(json) as Record<string, unknown>;
}
