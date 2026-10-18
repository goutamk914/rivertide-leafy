# Rivertide — architecture & build spec

Rivertide is Code the Cure's voice-first desktop companion for people whose words don't come as
easily as they used to (chemo brain, brain fog, fatigue). You speak naturally; Rivertide writes
clearly, answers questions, remembers what matters, and operates the computer for you. Leafy, the
pixel-art sprout, is its face.

This document is the contract every contributor (human or agent) builds against. If code and this
document disagree, fix one of them in the same change.

---

## 1. Repository layout (npm workspaces)

```
Rivertide/
  package.json            workspaces: packages/*, app, website
  tsconfig.base.json
  docs/                   ARCHITECTURE.md (this), DESIGN.md
  assets/leafy/           original Leafy pose pack (source of truth for art)
  packages/leafy/         @rivertide/leafy  — pose data, canvas renderer, moods, <LeafySprite/>
  packages/island/        @rivertide/island — <DynamicIsland/> (port of jhaemin/dynamic-island to motion)
  app/                    Electron desktop app ("Rivertide")
  website/                Next.js marketing site (static export)
  reference/              the four cloned upstream repos — read-only, never imported, gitignored
```

Workspace packages are consumed as TypeScript source (`"main": "src/index.ts"`). Vite and Next
transpile them; nothing is pre-built.

## 2. Product surface

| Surface | What it is | How you get there |
|---|---|---|
| **Dictation** | Hold `fn`, speak, release → cleaned text is pasted at the cursor | `fn` (mac) / configurable hotkey |
| **Ask** | Hold `ctrl+fn`, ask a question → the answer is pasted at the cursor | `ctrl+fn` |
| **Command (Jarvis)** | Speak an instruction → Leafy does it (open apps, search files, timers, volume, notes, reminders, web, Shortcuts…) and answers out loud | `shift+fn`, double-clap, Leafy's mic button, `⌘⇧L` |
| **Leafy palette** | Spotlight-style search over apps, files, commands, notes, facts, history, documents + "Ask Leafy" | `⌘⇧Space` (configurable), click Leafy |
| **Leafy pet** | Floating animated sprite with a hover toolbar (compose, voice, menu) and a speech bubble | Always on screen (can be hidden) |
| **Dynamic Island** | Top-center live activity: listening waveform, thinking, acting, confirmations, results | Appears automatically during any voice/agent activity |
| **Dashboard** | Home, History, Chat, Knowledge (facts/graph/dictionary), Documents, Insights (usage + speech dynamics), Notes & reminders, Settings | Tray, dock, Leafy menu, palette |

Hands-free extras: double-press `fn` locks dictation on (press again to finish); double-clap or
saying "Hey Leafy" (both opt-in) summons Leafy and starts a voice command; `Esc` cancels anything
in flight.

## 3. Desktop app (`app/`)

### 3.1 Stack
Electron 44 · TypeScript 5.9 · React 19 · Vite 8 (renderer, multi-page) · esbuild (main + preload →
CJS) · Tailwind CSS 4 · Zustand 5 · motion 14 · zod 4 · @anthropic-ai/sdk · Vitest 5 ·
electron-builder 26. Native macOS helper in Swift (`app/native/rivertide-helper.swift`).

### 3.2 Folder ownership
```
app/
  package.json, tsconfig*.json, vite.config.ts, vitest.config.ts, electron-builder.yml
  scripts/            build-main.mjs, dev.mjs, build-native.sh, make-icons.mjs
  native/             rivertide-helper.swift (+ compiled binary, gitignored)
  resources/          icons, tray template images (generated from Leafy)
  src/shared/         pure TS, no Node/DOM APIs: domain types, settings schema, IPC contract, text utils
  src/main/           Electron main process (Node)
    index.ts            lifecycle only
    context.ts          AppContext: explicit dependency container passed to every service
    windows/            dashboard, island, leafy, palette, engine windows + secure defaults
    ipc/                register.ts (validation + routing) and handlers/<namespace>.ts
    store/              json-store (atomic, debounced, backup) + one repository per domain
    secrets.ts          safeStorage-encrypted API keys, never sent to renderers
    ai/                 llm/ (anthropic.ts, openai-compatible.ts, registry.ts), stt/, prompts/
    voice/              session state machine, pipeline (stt → polish/answer/agent → output)
    agent/              loop.ts, policy.ts, router.ts (local fast-path intents), tools/*.ts
    os/                 exec.ts (safe execFile), helper.ts (native helper client), apps.ts,
                        files.ts, system.ts, media.ts, paste.ts, notify.ts, shortcuts.ts
    knowledge/          facts, extraction, graph builder, search index (BM25), documents import
    analytics/          usage stats + speech dynamics (deterministic metrics, personal baseline)
    scheduler/          reminders & timers
    input/              hotkeys (globalShortcut), fn/keys via helper, clap → session bridge
    wake/               "Hey Leafy": service (utility process lifecycle), worker + ONNX chain (§3.13)
    tray.ts, permissions.ts, logger.ts
  src/preload/        index.ts — exposes `window.rivertide` (typed invoke/on over an allowlist)
  src/renderer/
    main.html island.html leafy.html palette.html engine.html
    lib/                ipc client, browser mock (for `npm run dev:web`), hooks, formatters
    ui/                 tokens.css, fonts, primitives (Button, Field, Toggle, Select, Kbd, …)
    dashboard/          main window React app (routes, pages, stores)
    island/             Dynamic Island window
    leafy/              Leafy pet window
    palette/            Leafy command palette window
    engine/             hidden audio engine: mic capture, VAD, level meter, clap detector, TTS, cues
  test/               Vitest suites mirroring src/ (unit + integration with fakes)
```

### 3.3 Process model & windows
- **Main** owns all state, all network calls, all OS access, all secrets.
- **Renderers never call the network** (CSP `connect-src 'self'`), never see API keys, and talk to
  main only through `window.rivertide.invoke(channel, payload)` / `window.rivertide.on(event, cb)`.
- Every window: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, navigation and `window.open` denied, permission handler grants `media`
  only to our own `engine` window. A strict CSP is sent as a response header by the `app://` protocol handler (a meta tag would block Vite's React-refresh preamble in dev).

| Window | Size | Key options |
|---|---|---|
| dashboard | 1180×780, min 900×620 | `titleBarStyle: 'hiddenInset'` (mac), hide-on-close, restore last route |
| island | 460×260 transparent | top-center of the display under the cursor, `type: 'panel'` (mac), `focusable: false`, `setAlwaysOnTop(true, 'screen-saver')`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, click-through via `setIgnoreMouseEvents(true, { forward: true })` except while the pointer is over interactive island content. Shown/hidden with `showInactive()` / `hide()`; never steals focus. |
| leafy | 240×280 transparent | bottom-right by default, position persisted, same always-on-top/click-through rules as island, manual drag via IPC |
| palette | 720×560 transparent, rounded via CSS | centered on cursor display at 22% height, takes focus, hides on blur/Esc, returns focus to the previous app on hide (mac: `app.hide()` when no other Rivertide window is visible) |
| engine | hidden 1×1 | `show: false`, `backgroundThrottling: false`; owns the microphone |

### 3.4 IPC contract (`src/shared/ipc.ts`)
Single source of truth: a map of invoke channels (`'namespace:action'`) to zod request schemas and
TypeScript response types, plus a map of event channels to payload types. Main validates every
request with zod and rejects senders that are not our windows. The preload exposes only channels
listed in the contract. Adding a channel = edit `shared/ipc.ts` + add the handler; the preload and
renderer client are generic.

### 3.5 Voice pipeline
```
trigger (fn / ctrl+fn / shift+fn / hotkey / clap / "Hey Leafy" / Leafy / palette)
  → voice.session.start(mode, source)
      capture frontmost app (helper) BEFORE any window appears
      island: listening · Leafy: listening · engine: startCapture{ requestId, endpointing }
  → user speaks (engine streams levels → island waveform; VAD tracks speech & pauses)
  → stop (key up / VAD end-of-speech / button / max duration)
      engine → main: WAV (16 kHz mono PCM16) + speech stats
  → STT (Groq whisper-large-v3-turbo | OpenAI | custom | local whisper.cpp), dictionary terms as prompt
      hallucination guard (empty/"thank you"/[BLANK_AUDIO] on no-speech audio → "didn't catch that")
  → by mode
      dictate : polish (LLM, injection-guarded formatter prompt) → paste at cursor → history
      ask     : answer (LLM + relevant facts) → paste at cursor → history
      command : local intent router (instant, offline) → else agent loop (tools) → speak + show
  → background (never blocks the user): knowledge extraction, speech-dynamics metrics,
    dictionary learning, history broadcast
```
- Sessions have ids; outputs are applied strictly in order through a queue (no dropped recordings).
- Every stage has a timeout (STT 30 s, LLM 30 s, agent 90 s total, tool 15 s) and a friendly error.
- If the LLM fails during dictation, the raw transcript is pasted (never lose the user's words).
- If paste fails, the text stays on the clipboard and the island says so.
- End-of-speech silence for hands-free modes defaults to **2.2 s** (generous for slower speech);
  configurable 1–5 s. Push-to-talk never auto-stops early. Hard cap 10 min.

### 3.6 Key handling
- macOS: `rivertide-helper` (Swift, JSON lines over stdio) reports `fn` and modifier state from a
  listen-only CGEventTap and performs paste (CGEvent ⌘V), media keys, frontmost-app queries and
  AX focused-text reads. Tap auto re-enables after timeouts. Helper is restarted with backoff if it
  exits. Requires Accessibility (and on some systems Input Monitoring) — onboarding walks through it
  and tells the user to set "Press 🌐 key to: Do Nothing".
- `fn` semantics: hold = record while held; quick double-press (≤ 450 ms) = lock on, next press
  stops; `ctrl` held at fn-down → ask mode; `shift` held at fn-down → command mode.
- Everywhere: `globalShortcut` toggles — palette `CommandOrControl+Shift+Space`, voice command
  `CommandOrControl+Shift+L`, dictation toggle `CommandOrControl+Shift+D` (avoid `Option+Space`;
  ChatGPT/Codex own it). All configurable; `globalShortcut.register` failures are surfaced in
  Settings, never silent.
- The app sets an application menu with the standard Edit roles so ⌘C/⌘V/⌘A work in the palette.

### 3.7 Native helper protocol (`app/native/rivertide-helper.swift`)
One JSON object per line. Helper → app:
```json
{"type":"ready","version":1,"accessibility":true}
{"type":"key","key":"fn","down":true,"mods":{"ctrl":false,"shift":false,"alt":false,"cmd":false},"t":123456}
{"type":"result","id":"7","ok":true,"data":{}}
{"type":"error","id":"7","message":"..."}
{"type":"log","level":"warn","message":"event tap re-enabled after timeout"}
```
App → helper (`id` is echoed in the result):
```json
{"id":"1","cmd":"ping"}
{"id":"2","cmd":"frontmostApp"}                      → {"name","bundleId","pid"}
{"id":"3","cmd":"paste","bundleId":"com.apple.Notes"} → activates target (optional) then ⌘V
{"id":"4","cmd":"typeText","text":"…"}                → unicode keystrokes (paste fallback)
{"id":"5","cmd":"focusedText"}                        → {"role","value","selectedText"} (≤ 4000 chars)
{"id":"6","cmd":"mediaKey","key":"playpause|next|previous|mute|volumeUp|volumeDown"}
{"id":"7","cmd":"checkAccess"}                        → {"accessibility":bool}
```

### 3.8 AI providers
- **LLM** roles: `polish`, `answer`, `agent`, `chat`, `extract`. Each role picks `{ providerId, model }`.
  Providers: `anthropic` (official SDK, default model `claude-opus-5-5`, adaptive thinking, effort per
  role: polish/answer/extract `low`, agent/chat `medium`, server-side refusal fallback
  `fallbacks: "default"`), and OpenAI-compatible `groq`, `openai`, `openrouter`, `ollama` (local,
  private), `custom`. The Anthropic code lives in its own file and uses only the SDK.
- **STT**: `groq` (whisper-large-v3-turbo, recommended), `openai` (gpt-4o-mini-transcribe /
  gpt-4o-transcribe / whisper-1), `custom` (OpenAI-compatible endpoint), `local` (whisper.cpp
  `whisper-cli` found on disk; never auto-downloaded).
- Neutral transcript type for the agent; the Anthropic provider stores the raw assistant content
  blocks and replays them unchanged (thinking blocks must round-trip).

### 3.9 Agent (Jarvis)
- Local **intent router** first (regex/grammar, no network): open/quit app, volume/mute, media,
  timers, "what time is it", dark mode, lock screen, search files/web, open dashboard pages, new
  note. Anything else → LLM agent loop (max 8 tool rounds).
- Tools have a **risk level**: `read` (auto), `act` (auto, shown in island), `confirm` (needs a
  yes — click, Enter, or saying "yes"). Users can override per tool: Always / Ask / Never.
- Tool inputs are zod-validated; paths are resolved and checked; URLs must be http(s); no shell
  tool, ever. Content from documents/files/web is wrapped as untrusted data in prompts.
- Tool set: `open_app`, `quit_app`(confirm), `open_url`, `web_search`, `search_files`, `open_file`,
  `reveal_file`, `get_system_status` (time, date, battery, volume, appearance), `set_volume`,
  `set_dark_mode`, `media_control`, `lock_screen`(confirm), `sleep_display`(confirm),
  `take_screenshot`, `set_timer`, `create_reminder`, `list_reminders`, `cancel_reminder`,
  `create_note`, `search_notes`, `remember_fact`, `recall_facts`, `search_documents`,
  `search_history`, `copy_to_clipboard`, `read_clipboard`, `type_text`(confirm),
  `compose_email` (opens mailto, never sends), `run_shortcut`(confirm), `list_shortcuts`,
  `open_system_settings`, `open_rivertide`, `get_weather` (Open-Meteo, no key).

### 3.10 Data (all local, `app.getPath('userData')`)
| File | Shape |
|---|---|
| `settings.json` | `Settings` (zod schema in `shared/settings.ts`, versioned + migrated) |
| `secrets.json` | `{ [providerId]: base64(safeStorage.encryptString(key)) }` |
| `history.json` | `{ version, items: HistoryItem[] }` — dictations, asks, commands (cap 5000, retention setting) |
| `knowledge.json` | `{ version, facts: Fact[] }` |
| `dictionary.json` | `{ version, entries: DictionaryEntry[] }` |
| `chats.json` | `{ version, sessions: ChatSession[] }` |
| `documents.json` + `documents/<id>.txt` | metadata + extracted text |
| `notes.json`, `reminders.json`, `dynamics.json` | notes, reminders, per-session speech metrics |
| `leafy.json` | pet position, last mood, stats (streaks) |

All timestamps are ISO-8601 strings in UTC (`2026-10-15T14:03:00.000Z`). IDs are
`<base36 time><4 random chars>`. Writes are atomic (tmp + rename), debounced 250 ms, with a `.bak`
copy; a corrupt file is restored from `.bak` and never silently overwritten with defaults.
Export (zip-free folder copy) and wipe are in Settings → Privacy. Audio is not kept unless the user
turns on "Keep recordings".

### 3.11 Speech dynamics (non-clinical)
Deterministic per-session metrics from the engine's VAD + raw transcript: speaking time, words per
minute of speech, pause count/length, long pauses (>2 s), filler rate, repetitions,
self-corrections, type-token ratio, edit ratio (raw vs polished). A personal baseline (median of the
last 14 days, ≥5 sessions) turns these into a 0–100 "fog index" with plain-language labels
("steady", "a little foggy", "foggy"). AI-written text is never measured — only the user's own
speech. Every screen that shows it carries "Not a diagnosis".

### 3.12 Clap detection
Opt-in. Engine keeps a raw mic stream open while enabled (`echoCancellation`, `noiseSuppression`
and `autoGainControl` all off — they smear transients). macOS shows its mic indicator; Settings
says so. Audio never leaves the device and is never stored.

Detector (pure TS in `renderer/engine/dsp/clap.ts`, fed 48 kHz frames, 512-sample Hann FFT, hop 256):
1. Features per hop: band energy E (dBFS, 2–8 kHz), noise floor F (running 20th percentile of E
   over ~3 s, frozen during events, floored at −70 dBFS), flux ratio R (fraction of 1–10 kHz bins
   that rose ≥ 8 dB since the last hop), spectral flatness over the same band.
2. Onset candidate: `E − F ≥ 15 dB` (scaled by sensitivity), `E − E_prev ≥ 8 dB`, `R ≥ 0.5`,
   flatness ≥ 0.25; the peak is the local max over the next 3 hops.
3. Validate as a clap: decays ≥ 12 dB below peak within 80 ms; crest factor ≥ 5 in a 50 ms window.
4. 100 ms refractory after a clap peak.
5. Pair: second clap 150–750 ms after the first, peaks within 8 dB, energy back near the floor in
   between.
6. Isolation: no candidate in the 400 ms before clap 1, no third onset within 350 ms after clap 2
   (rejects applause, typing, music). Fire after that window closes; then 1.5 s cooldown.
7. Gates: paused while recording, while speaking (TTS), when the room floor is above −35 dBFS, and
   when main reports keyboard/mouse activity in the last second (`powerMonitor.getSystemIdleTime()`).
8. Optional calibration in onboarding (three double-claps → threshold at ~70% of median prominence).

A double-clap only *summons* Leafy (greeting + listening for a command). It never runs an action by
itself, so a false positive costs one dismissal.

### 3.13 Wake word ("Hey Leafy")
Opt-in (off by default), English, fully on-device. Web Speech recognition does not work in
Electron and Porcupine has no free tier, so Rivertide runs its own model. Like a double clap, it
only *summons* Leafy (greeting + command capture); it never runs an action by itself.

```
engine window   shared speech-capture stream (echo cancellation, noise suppression, AGC on)
                → WakeFramer: resample to 16 kHz, 80 ms PCM16 frames
                → send `engine:wake-audio` { samples, fresh } (sender- and zod-checked in main)
main            wake/service.ts forwards frames to the utility process while it is ready
utility process dist-electron/wake-worker.cjs, onnxruntime-node on the CPU (1–2 threads)
  stage 1       openWakeWord melspectrogram → speech embedding → hey_leafy.onnx (16 × 96 → score)
                fire at score ≥ 0.8 / 0.6 / 0.4 (low / medium / high sensitivity); 2 s cooldown
  stage 2       Moonshine Tiny (int8) transcribes the last 1.5 s (in-memory ring buffer).
                Confirmed if the transcript names Leafy after a greeting, or if "Hey, Leafy."
                scored as a forced continuation of the transcript is within 6 / 8 / 10 nats of it
                → { detected | rejected, score, margin }
main            detected → voice.onWake → command session (source 'wake', endpointed, "Yes?")
```
- Gates (engine): no frames while capturing or speaking, nor for 700 ms after speech ends; the
  first frame after any pause is `fresh` and the worker clears its buffers.
- Privacy: audio exists only in memory (a 1.5 s ring in the worker). The worker never sends
  audio or words back, and transcripts are never logged. macOS shows its mic indicator while on;
  Settings → Leafy says so.
- Lifecycle: the worker is forked only while the setting is on and killed when it is turned off.
  After a crash it restarts (at most 3 times a minute), then a toast explains. Missing model files
  or an Intel Mac (onnxruntime-node ships Apple-silicon binaries only) → a plain toast, no start.
- Models in `resources/wake-word/` (NOTICE.md there): `hey_leafy.onnx` is ours (MIT), trained only
  on synthetic speech plus permissively licensed real audio (`app/scripts/wake-word/README.md`).
  The feature models (Apache-2.0) and Moonshine (MIT) are fetched with pinned SHA-256 by
  `npm run fetch:wake-models`. openWakeWord's pre-trained (CC BY-NC-SA) models are not used.
- Measured false-accept rates and recall: `app/scripts/wake-word/README.md` → Results.

## 4. Design system (shared by app and website)
See `docs/DESIGN.md`. Summary: dark-first, sibling to codethecure.org — near-black tonal surfaces,
Inter display with tight tracking, Atkinson Hyperlegible Next body (legibility for fatigued
readers), JetBrains Mono for keys; one accent, Leafy green; no gradients, glass or glow; motion is
`cubic-bezier(0.22, 1, 0.36, 1)` and springs with no bounce; every effect has a reduced-motion
branch.

## 5. Quality bar
- `npm run check` in `app/` = typecheck (renderer + node configs) + Vitest. Must pass.
- Pure logic (router, VAD, clap detector, metrics, BM25, prompt builders, stores, policy, agent loop
  with a fake provider, pose sequencer) has unit tests; target ≥ 80% line coverage on `src/shared`,
  `src/main/{agent,knowledge,analytics,voice,store}` and `src/renderer/engine/dsp`.
- No `any` without a comment, no `console.log` (use `logger`), no swallowed errors, no mutation of
  shared state outside its owner, functions < 50 lines where practical, files < 400 lines.
