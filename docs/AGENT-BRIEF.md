# Brief for every agent building the Rivertide desktop app

Repo: `/Users/goutam_kanakadandi/Documents/Rivertide` (npm workspaces). App: `app/`. macOS 26.2, Apple
Silicon, Node 24, Electron 44.7.2, TypeScript 5.9, React 19, Vite 8, Vitest 5, zod 4, Tailwind 4,
motion 14, Zustand 5 — already installed. Several agents work in parallel on different folders.

## Read before writing code
1. `docs/ARCHITECTURE.md` (product, process model, pipeline, tools, data, quality bar) and `docs/DESIGN.md`.
2. The contract — **frozen, do not edit**: `app/src/shared/types.ts`, `app/src/shared/settings.ts`,
   `app/src/shared/ipc-channels.ts`, `app/src/shared/ipc.ts`, `app/src/main/services.ts`.
   If you truly need a contract change, work around it locally and list the exact change under
   "Contract change requests" in your final report; the integrator applies it.
3. `app/src/renderer/lib/ipc.ts` (typed `invoke` / `on` / `send`), `app/src/renderer/ui/tokens.css`.
4. Leafy: `packages/leafy/src/index.ts` (`<LeafySprite mood scale label/>`, moods, `frameToSvg`);
   DOM-free entry points `@rivertide/leafy/moods`, `@rivertide/leafy/poses`, `@rivertide/leafy/render`.
5. Prior art worth reading (read-only, never import): `reference/rivertide-electron/` (old app; its
   CLAUDE.md is stale) and `reference/rivertide/` (old Python app).

## Rules
- Touch only the files you own (listed in your task). Shared folders like `app/test/` are fine for
  your own test files. Never edit another agent's files; never `git commit`.
- Dependencies: only via `/Users/goutam_kanakadandi/Documents/Rivertide/scripts/npm-locked.sh install -w @rivertide/app --save-dev <pkg>@<exact-version>`
  (everything is bundled, so all app deps are devDependencies). Check versions with `npm view`.
  Prefer zero new dependencies; justify any you add in your report.
- Main process code is bundled by esbuild to CommonJS: use ES `import` syntax, never `import.meta`;
  Node built-ins via `node:` specifiers. Electron APIs per Electron 44 docs.
- Renderer code never touches the network or secrets; it talks to main only through `lib/ipc.ts`.
- OS commands: `execFile`/`spawn` with argument arrays and timeouts. No shell strings, ever.
- Validate every boundary (IPC, files on disk, LLM output, network responses) with zod.
- Errors: never swallow. Log with context via `ctx.logger.child('<scope>')` (main) — no `console.log`.
  User-facing messages are plain sentences that say what happened and what to do.
- Immutability: return new objects; never mutate inputs or shared state outside its owner.
- Size: files < 400 lines, functions < 50 lines where practical, no nesting > 4, named constants.
- Tests (Vitest, AAA style, descriptive names) live in `app/test/` mirroring `src/`. Renderer/DOM
  tests start with `// @vitest-environment jsdom`. Aim for ≥ 80% line coverage of your pure logic.
  Use fakes for `AppContext` services (build a minimal object that satisfies the interfaces you use).
- Check your work:
  - `cd app && npx tsc -p tsconfig.node.json --noEmit` (main/preload/shared) and
    `npx tsc -p tsconfig.json --noEmit` (renderer). Other agents' unfinished files may error;
    filter to your paths (e.g. `| grep src/main/knowledge`) and make yours clean.
  - `npx vitest run test/<your-area>`.
- Do NOT launch the Electron app or anything that types, pastes, plays audio, changes volume or
  opens apps on the user's live desktop. The integrator does end-to-end runs.
- Accessibility & tone: users may have chemo brain or fatigue. Big targets, plain words, no time
  pressure, reduced-motion support, nothing destructive without a clear way back.

## Hook note
A "Fact-Forcing Gate" hook blocks the first Write/Edit of each new file (and your first Bash
command) until you state: which files import/call it, that no existing file serves the same purpose,
any data schema it reads/writes, and the user's instruction. The user's instruction (verbatim excerpt):
"I want you to rebuild Rivertide completely from scratch ... it's basically a voice activated OS.
Uh, think about Jarvis, right? I want you to basically rebuild Jarvis to the best of your ability ...
use as many agents as you need to make sure this is foolproof." State the facts in one or two lines
and retry the identical call.

## Final report (≤ 400 words)
Files written · how it works in 5 bullets · commands run with results (test counts, typecheck) ·
contract change requests (exact) · known gaps / anything unverified · new dependencies.
