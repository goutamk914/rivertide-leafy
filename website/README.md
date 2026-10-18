# Rivertide website

The marketing site for Rivertide, Code the Cure's voice companion for Mac. Next.js 16 (App Router)
exported as static files, so it runs on GitHub Pages or any static host.

It is built to feel like a sibling of codethecure.org: near-black tonal surfaces, Inter display
type with a muted second beat, Atkinson Hyperlegible Next for reading, JetBrains Mono for keys,
Leafy as the only illustration besides hand-drawn line doodles. Design rules live in
[`docs/DESIGN.md`](../docs/DESIGN.md); product facts in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
If the app changes what it sends where, update `content/privacy.ts` in the same change.

## Run it

From the repository root (npm workspaces):

```bash
npm run dev -w website        # http://localhost:3000
npm run build -w website      # static export into website/out
npm run typecheck -w website
npm run test -w website       # Vitest: demo state machine and content rules
```

Install dependencies with `scripts/npm-locked.sh install` from the repository root, never with a
plain `npm install` while other workspaces are being worked on.

## How it is put together

| Path | What it holds |
|---|---|
| `app/` | Routes: `/`, `/leafy/`, `/privacy/`, `/download/`, plus `sitemap.ts`, `robots.ts`, icons and the Open Graph image |
| `components/island/` | The navigation, built on `@rivertide/island`: rest pill, chapter + progress, menu card, and live activities the demos play |
| `components/home/` | One component per home chapter |
| `components/leafy/` | Mood playground, the 100-pose grid and the Leafy palette |
| `content/` | All copy that states a fact (privacy flows, permissions, shortcuts, FAQ, demo transcripts) |
| `styles/` | Tokens, base, component recipes, motion, and per-page styles, layered under Tailwind |

The island is the site navigation. Sections opt in to the chapter readout with
`data-chapter="Name"`. Any client component can borrow the island for a moment with
`useIslandActivity().show(scene, holdMs)`.

Everything that moves has a `prefers-reduced-motion` branch: reveals become fades, the scroll
story becomes static text, the island changes size instantly.

## Brand assets

`app/icon.svg`, `app/apple-icon.png` and `app/opengraph-image.png` are drawn from Leafy's pixel
data. They are committed; regenerate after changing Leafy or the tagline:

```bash
npm run assets -w website
```

## Deploying to GitHub Pages

GitHub Pages serves project sites from a subpath (`https://codethecure.github.io/rivertide-website/`),
so the build needs that base path. Every page link goes through `next/link` and every asset is
either a static import or passes through `withBase()` in `lib/site.ts`, so one variable moves the
whole site:

```bash
NEXT_PUBLIC_BASE_PATH=/rivertide-website npm run build -w website
```

| Variable | Default | Use |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | empty | Subpath the site is served from. Leave empty for a custom domain. |
| `NEXT_PUBLIC_SITE_URL` | `https://codethecure.github.io` + base path | Absolute URL used for canonical links, the sitemap and Open Graph. Set it when using a custom domain. |

`.github-pages-deploy.yml` in this folder is a ready-made workflow. Copy it to
`.github/workflows/deploy-website.yml` at the repository root, then in the repository settings
choose Pages, Source: GitHub Actions. It builds with the repository name as the base path and
publishes `website/out`.

To preview a production build locally:

```bash
npm run build -w website
python3 -m http.server 4321 -d website/out   # http://localhost:4321
```
