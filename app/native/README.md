# rivertide-helper (macOS)

A single-file Swift CLI (`rivertide-helper.swift`) that the Electron main process spawns and talks
to over stdio (client: `app/src/main/os/helper.ts`). It:

- reports `fn` (Globe) presses with the modifier state from a **listen-only** `CGEventTap`
  (re-enabled automatically after `tapDisabledByTimeout` / `tapDisabledByUserInput`);
- pastes (⌘V via `CGEvent`, optionally activating a target app first), types unicode text,
  posts media keys, and reads the frontmost app and the focused text field (Accessibility API);
- exits with code 0 as soon as stdin closes, so it never outlives the app.

## Permissions

- **Accessibility** is needed for `paste`, `typeText`, `mediaKey` and `focusedText`. Without it they
  reply `{"type":"error","message":"accessibility-missing"}`. `checkAccess` and the `ready`
  message report the current state.
- **Input Monitoring** (on some systems) is needed for the event tap. If the tap can't be created,
  the helper logs a warning and retries every 5 s, so granting permission later works without a
  restart.
- macOS attributes these permissions to the *responsible* app: Rivertide.app when packaged, or
  your terminal when you run the binary by hand.
- Tell users to set **System Settings → Keyboard → "Press 🌐 key to" → Do Nothing**.

## Protocol

Newline-delimited JSON, as specified in `docs/ARCHITECTURE.md` §3.7.

| App → helper | Reply `data` |
|---|---|
| `{"id":"1","cmd":"ping"}` | `{"pong":true}` |
| `{"id":"2","cmd":"frontmostApp"}` | `{"name","bundleId","pid"}` |
| `{"id":"3","cmd":"paste","bundleId":"com.apple.Notes"}` | `{}` (`bundleId` optional) |
| `{"id":"4","cmd":"typeText","text":"…"}` | `{}` |
| `{"id":"5","cmd":"focusedText"}` | `{"role","value","selectedText"}`; strings ≤ 4000 chars, empty for password fields |
| `{"id":"6","cmd":"mediaKey","key":"playpause"}` | `{}`; keys: `playpause next previous mute volumeUp volumeDown` |
| `{"id":"7","cmd":"checkAccess"}` | `{"accessibility":bool}` |

Helper → app: `ready`, `key`, `result`, `error` and `log` messages (see §3.7). An unknown `cmd` is
answered with an `error` that carries the request's `id`. A line that isn't valid JSON gets an
`error` without an `id`, and the helper keeps running.

## Build

```sh
bash app/scripts/build-native.sh   # or: npm run build:native -w app
```

This produces the universal binary `app/native/rivertide-helper` (arm64 + x86_64, macOS 13+) with
the Command Line Tools `swiftc`, compiled in Swift 5 language mode. On other platforms the script
prints a skip message and exits 0. The binary and `build/` are gitignored.

## Test by hand

```sh
printf '{"id":"1","cmd":"ping"}\n{"id":"2","cmd":"frontmostApp"}\n{"id":"3","cmd":"checkAccess"}\n{"id":"4","cmd":"nope"}\nnot json\n' \
  | ./app/native/rivertide-helper
```

Expect a `ready` line, one reply per request line, then exit code 0 at EOF. To watch `fn` events,
run `./app/native/rivertide-helper` with no input pipe and press `fn` / `ctrl+fn`. Don't try
`paste`, `typeText` or `mediaKey` casually: they act on whatever app is in front.

The Node client is tested against a protocol fake (`app/test/fixtures/fake-helper.mjs`):
`npx vitest run test/main/os/helper.test.ts` from `app/`.
