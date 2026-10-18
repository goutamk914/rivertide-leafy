# Rivertide (desktop app)

Rivertide is Code the Cure's voice-first desktop companion. Hold `fn` and speak: Rivertide writes
clearly, answers questions, remembers what matters and operates the computer for you. Leafy, the
pixel-art sprout, is its face.

This folder is the Electron app. The full design is in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
and [`../docs/DESIGN.md`](../docs/DESIGN.md).

## Requirements

- macOS 13 or later on Apple Silicon or Intel (Windows and Linux run, without the `fn` key features)
- Node 22.12 or later; install dependencies once from the repository root with `npm install`
- Xcode command line tools (for the native helper: `xcode-select --install`)

## Develop

```sh
npm run dev        # from app/ (or `npm run app:dev` from the repository root)
```

This starts three things and stops all of them when you press Ctrl+C or quit Rivertide:

1. the Vite dev server on http://localhost:5317 (renderer windows, hot reload),
2. esbuild in watch mode for the main process and preload (`dist-electron/`),
3. Electron, restarted automatically whenever the main or preload bundle changes.

Development uses its own data folder, `~/Library/Application Support/Rivertide Dev`, so experiments
never touch your real history or keys.

### Browser-only UI work

```sh
npm run dev:web
```

Opens the renderer in a normal browser with a mock bridge (no Electron, no main process). Visit
`/main.html`, `/island.html`, `/leafy.html` or `/palette.html` on http://localhost:5317.

## Build and package

```sh
npm run build      # native helper + renderer (dist/) + main and preload (dist-electron/)
npm start          # run the built app
npm run dist:adhoc # universal DMG + zip in release/, ad-hoc signed (for testing on this Mac)
npm run verify:mac # check the packaged app in release/mac-universal/ (see Releases)
npm run check      # type-check both configs and run every test
node scripts/make-icons.mjs   # regenerate resources/*.png from the Leafy pose pack
```

`npm run build:main` bundles `src/main/index.ts` → `dist-electron/main.cjs` and
`src/preload/index.ts` → `dist-electron/preload.cjs`, and copies the tray icons next to them.

## Releases (signing, notarization, updates)

Real users get a **signed and notarized universal DMG** (Apple Silicon + Intel) from
[GitHub releases](https://github.com/CodeTheCure/rivertide-electron/releases), which is where the
website's "Download for Mac" button points. Signing is what makes macOS keep Rivertide's permissions
across updates and what lets auto-update work at all, so only builds signed with the Developer ID
certificate are shipped.

### What a release build contains

`electron-builder.yml` produces `Rivertide-<version>-mac-universal.dmg` (what people download),
`Rivertide-<version>-mac-universal.zip` (what auto-update installs) and `latest-mac.yml`:

- **Signing:** Developer ID Application certificate, hardened runtime, secure timestamp, the
  entitlements in `resources/entitlements.mac.plist` (microphone, Apple Events, JIT). The native
  helper (`Contents/Resources/native/rivertide-helper`) is signed as a nested binary first; macOS
  attributes its Accessibility and Input Monitoring use to **Rivertide**.
- **Notarization:** notarytool with an App Store Connect API key; the ticket is stapled to the app.
- **Fuses** (`electronFuses`, applied with @electron/fuses before signing): `RunAsNode`,
  `EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable` off; asar integrity
  validation and `OnlyLoadAppFromAsar` on; cookie encryption on; no extra `file://` privileges.
- **Updates:** `src/main/updater.ts` (electron-updater) checks GitHub 30 seconds after launch and every
  6 hours, downloads in the background, shows a notification, and installs on quit. Only
  *published* releases are offered; drafts and development builds are ignored.

`npm run verify:mac` checks all of this on the built app, plus that `app.asar` holds a production
(not `npm run dev`) bundle. Flags: `--release` adds the Developer ID, hardened runtime, notarization
and Gatekeeper checks; `--artifacts` repeats every check on the app inside the zip and the DMG;
`--launch` starts the app with a throwaway data folder and waits for the main process, the `fn`
helper and the audio engine to report ready. CI runs it with all three.

### Local builds

- `npm run dist:adhoc` is for trying the packaged app on your own Mac. It is ad-hoc signed without
  the hardened runtime (ad-hoc signing plus the hardened runtime fails library validation), is not
  notarized, and can't auto-update. macOS treats every rebuild as a new app, so grant permissions
  again after each one (or `tccutil reset All org.codethecure.rivertide`). To keep your real data out
  of it: `open -n release/mac-universal/Rivertide.app --args --user-data-dir=/tmp/rivertide-test`.
- `npm run dist:signed` makes a shippable build on your own Mac if the Developer ID Application
  certificate is in your login keychain and `APPLE_API_KEY` (path to the `.p8`), `APPLE_API_KEY_ID`
  and `APPLE_API_ISSUER` are set. Then run `npm run verify:mac -- --release --artifacts --launch`.
- `pack:adhoc` / `pack:signed` only package; they ship whatever is in `dist/` and `dist-electron/`.
  `npm run dev` leaves a development bundle there, so run `npm run build` first (the `dist:*`
  scripts do).

### Cutting a release

1. Bump `version` in `app/package.json` (for example `2.0.1`) and merge it.
2. Push a matching tag: `git tag v2.0.1 && git push origin v2.0.1`.
3. The **Release (macOS)** workflow (`.github/workflows/release.yml`) tests, builds, signs,
   notarizes and verifies on a macOS runner, uploads the files to a **draft** release, and checks
   they all arrived.
4. Open the draft on GitHub, download the DMG, try it, write the notes, press **Publish**. Only then
   do the website button and auto-update see it.

**Dry run:** Actions → Release (macOS) → Run workflow. It does everything except publishing and
attaches the DMG and zip to the run. With the secrets in place it is fully signed and notarized;
without them it falls back to an ad-hoc build and says so, which is a cheap way to test the pipeline
before the certificate exists.

### Secrets the organization must add

The workflow's job runs in a GitHub **environment named `release`**. Create it under the repository's
Settings → Environments, add the secrets below to it, and protect it: required reviewers (so a run
gets the signing keys only after someone approves it) and deployment branches and tags limited to
`main` and `v*` (dry runs start from `main`). Never commit any of these secrets, and never paste
them into an issue.

| Secret | What it is | How to get it |
|---|---|---|
| `MACOS_CERTIFICATE_P12_BASE64` | The **Developer ID Application** certificate and its private key, exported as `.p12`, base64-encoded | The Apple Developer account holder creates it (Certificates → +, Developer ID Application). In Keychain Access export the certificate *with* its key as `.p12`, then `base64 -i rivertide.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` | — |
| `APPLE_API_KEY_P8` | The contents of the App Store Connect API key file `AuthKey_<id>.p8` | App Store Connect → Users and Access → Integrations → Team Keys → +, role **Developer**. The file can be downloaded only once |
| `APPLE_API_KEY_ID` | That key's Key ID (10 characters) | Shown next to the key |
| `APPLE_API_ISSUER` | The Issuer ID (a UUID) | Shown above the key list |
| `RELEASE_TOKEN` *(optional)* | Fine-grained token with **Contents: read and write** on `CodeTheCure/rivertide-electron` | Only needed if this workflow runs in a different repository; otherwise the built-in `GITHUB_TOKEN` is used |

Rotate the API key and re-export the certificate if any of these ever leak. Keep signing with the
same Apple team: auto-update only accepts an update signed by the same Team ID.

### Upgrading from 1.x

Releases up to 1.4.1 were built differently (separate Intel and Apple Silicon DMGs, no update zip),
so plan for 1.x users to download 2.0 once from the website; from then on updates are automatic.
This workflow builds macOS only; Windows and Linux are not released from it.

## Permissions (macOS)

Rivertide asks for each one during onboarding; you can also open them from Settings → Permissions.

| Permission | Why | Where |
|---|---|---|
| Microphone | to hear you while you hold `fn` (or after a double clap) | System Settings → Privacy & Security → Microphone |
| Accessibility | to paste text at your cursor and read the `fn` key | Privacy & Security → Accessibility |
| Input Monitoring | needed on some Macs to see the `fn` key | Privacy & Security → Input Monitoring |
| Automation | to change volume and appearance and run your Shortcuts when you ask | Privacy & Security → Automation |

In development the permissions belong to **Electron**, not Rivertide, so grant them to the Electron
entry in each list.

## Troubleshooting

**Holding `fn` opens the emoji picker or starts Apple dictation.** Open System Settings → Keyboard
and set "Press Globe key to" (or "Press fn key to") to **Do Nothing**. Then quit and reopen Rivertide.

**`fn` does nothing at all.** Check Accessibility (and Input Monitoring) above. If Rivertide is
already ticked, untick it, tick it again, then reopen Rivertide. Settings → Permissions shows whether
the native helper is running.

**A keyboard shortcut doesn't work.** Another app may own it. Settings → Shortcuts shows which
shortcuts registered; pick a different one there.

**The microphone indicator stays on.** That happens only while "Double clap to summon Leafy" is on,
because clap detection needs to listen. Audio never leaves your computer and is never saved.

**Something looks broken.** The log is at `~/Library/Logs/Rivertide/rivertide.log` (API keys are
never written to it). It is safe to attach to a bug report.

## Where your data lives

Everything stays on your computer:

- `~/Library/Application Support/Rivertide/data/` — settings, history, notes, reminders, knowledge,
  dictionary, chats, Leafy (JSON files; each has a `.bak` copy of the previous version)
- `~/Library/Application Support/Rivertide/documents/` — text of documents you import
- `~/Library/Application Support/Rivertide/media/` — recordings, only if "Keep recordings" is on
- `secrets.json` in the data folder holds API keys encrypted with the macOS Keychain; they are never
  shown to any window and never exported

If a file is ever damaged, Rivertide restores it from its `.bak` copy. If that is damaged too, it
keeps the damaged file as `<name>.corrupt-<time>.json`, tells you, and starts that part fresh.

## Reset

- **Export first (optional):** Settings → Privacy → Export makes a copy in
  `~/Documents/Rivertide Export <date> <time>/` (API keys are not included).
- **Delete everything:** Settings → Privacy → Delete all data. Rivertide restarts empty.
- **By hand:** quit Rivertide, then delete `~/Library/Application Support/Rivertide`.
- **Permissions:** `tccutil reset Accessibility org.codethecure.rivertide` (and `Microphone`,
  `ListenEvent`) clears the macOS permission records so onboarding can ask again.

## Security model (short version)

Every window is sandboxed with context isolation and talks to the main process only through
`window.rivertide` (the preload), over an allow-list of channels. The main process validates every
request with zod and checks that it came from one of Rivertide's own windows. Pages are served from
`app://rivertide/` with a strict Content-Security-Policy (no network access from any window), new
windows and outside navigation are blocked (web links open in your browser), and only the hidden
audio engine window may use the microphone.
