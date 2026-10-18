# Rivertide

**You speak naturally. Rivertide writes clearly.**

Rivertide is Code the Cure's voice-first companion for people whose words don't come as easily as
they used to — chemo brain, brain fog, long COVID, fatigue. Hold `fn` and talk; clean text appears
wherever you're typing. Ask a question and the answer lands at your cursor. Clap twice and Leafy,
the pixel-art sprout, listens for whatever you need done on your computer.

| Folder | What's inside |
|---|---|
| [`app/`](app/) | The desktop app (Electron + React + TypeScript): dictation, answers, the Leafy assistant, the Dynamic Island, the Leafy palette, and the dashboard. |
| [`website/`](website/) | The marketing site (Next.js, static export) with the Dynamic Island navigation. |
| [`packages/leafy/`](packages/leafy/) | Leafy's 100 poses, pixel-perfect canvas/SVG renderer and mood animations. |
| [`packages/island/`](packages/island/) | The Dynamic Island React component, shared by the app and the website. |
| [`docs/`](docs/) | [Architecture](docs/ARCHITECTURE.md), [design system](docs/DESIGN.md), and the build brief. |
| [`assets/leafy/`](assets/leafy/) | The original Leafy pose pack. |
| `reference/` | The four upstream repositories this rebuild learned from (read-only, not part of the build). |

## Quick start

Requirements: macOS 13+ (Windows/Linux experimental), Node 22.12+, Xcode Command Line Tools (for the
native `fn` helper).

```bash
npm install
```

```bash
npm run app:dev
```

```bash
npm run web:dev
```

The app's own README covers permissions, API keys, building a `.dmg`, and troubleshooting.

## Shortcuts

| Do this | Rivertide does |
|---|---|
| Hold `fn`, speak, let go | Pastes your words, cleaned up, at the cursor |
| Double-press `fn` | Hands-free dictation until you press `fn` again |
| Hold `ctrl` + `fn` | Answers your question and pastes the answer |
| Hold `shift` + `fn`, or `⌘⇧L` | Leafy listens for a command ("open Calendar", "set a timer for 20 minutes") |
| `⌘⇧Space` | Opens the Leafy palette: search apps, files, notes, facts, history — or ask |
| Clap twice | Calls Leafy (opt-in; audio never leaves your computer) |
| `Esc` | Cancels whatever is in progress |

## Privacy in one paragraph

Everything Rivertide stores — history, notes, facts, documents, settings — lives in plain files on
your computer. Audio goes only to the speech-to-text provider you choose (or stays local with
whisper.cpp); text goes only to the AI provider you choose (or stays local with Ollama). API keys are
encrypted with your operating system's secure storage. Code the Cure runs no servers that see your
data. Speech insights are a gentle signal, not a diagnosis.

Built by [Code the Cure](https://codethecure.org). MIT licensed.
