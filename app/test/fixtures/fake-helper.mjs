#!/usr/bin/env node
// Fake rivertide-helper for tests. Speaks the JSON-lines protocol of docs/ARCHITECTURE.md §3.7
// over stdio, plus a few test-only commands (prefixed "__") to drive edge cases.
import { createInterface } from 'node:readline';

const SPLIT_DELAY_MS = 20;

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, data = {}) => write({ type: 'result', id, ok: true, data });
const fail = (id, message) => write(id === undefined ? { type: 'error', message } : { type: 'error', id, message });
const fnKey = (down) => ({
  type: 'key',
  key: 'fn',
  down,
  mods: { ctrl: true, shift: false, alt: false, cmd: false },
  t: 123456,
});

/** Writes one protocol line as two separate writes, cut at byte `cutAt` (may split a character). */
function writeSplit(message, cutAt, then) {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
  process.stdout.write(bytes.subarray(0, cutAt));
  setTimeout(() => {
    process.stdout.write(bytes.subarray(cutAt));
    then();
  }, SPLIT_DELAY_MS);
}

let isShapeBroken = false; // after __breakShapes, frontmostApp answers with a malformed payload

const handlers = {
  ping: (msg) => ok(msg.id, { pong: true }),
  frontmostApp: (msg) =>
    ok(msg.id, isShapeBroken ? { unexpected: true } : { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4242 }),
  focusedText: (msg) => ok(msg.id, { role: 'AXTextArea', value: 'hello', selectedText: '' }),
  checkAccess: (msg) => ok(msg.id, { accessibility: false }),
  paste: (msg) => fail(msg.id, 'accessibility-missing'),
  __emitKey: (msg) => {
    write(fnKey(msg.down ?? true));
    ok(msg.id);
  },
  // One key line delivered in two stdout chunks.
  __split: (msg) => writeSplit(fnKey(true), 25, () => ok(msg.id)),
  // A log line whose 4-byte emoji is cut in half between chunks.
  __splitUnicode: (msg) => {
    const message = { type: 'log', level: 'info', message: 'globe \u{1F310} key' };
    const prefix = Buffer.byteLength(`${JSON.stringify(message)}`.split('\u{1F310}')[0], 'utf8');
    writeSplit(message, prefix + 2, () => ok(msg.id));
  },
  __garbage: (msg) => {
    process.stdout.write('this is not json\n{"type":"mystery"}\n');
    ok(msg.id);
  },
  __breakShapes: (msg) => {
    isShapeBroken = true;
    ok(msg.id);
  },
  __silent: () => {},
  __crash: () => process.exit(1),
};

write({ type: 'ready', version: 1, accessibility: false });

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    fail(undefined, 'malformed JSON line');
    return;
  }
  const handler = handlers[msg.cmd];
  if (!handler) {
    fail(msg.id, `unknown command: ${msg.cmd}`);
    return;
  }
  handler(msg);
});
lines.on('close', () => process.exit(0));
