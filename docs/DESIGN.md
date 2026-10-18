# Rivertide design system

Rivertide is a sibling of codethecure.org. It should feel like the same studio made it: calm,
near-black, typographic, honest — with one living thing on screen, Leafy. Sources: the Code the
Cure site (`~/Documents/Projects/CodeTheCure website/codethecure-site/frontend`), the Claude Skills
anti-slop rules (taste, hallmark, ui-ux-pro-max), and jhaemin/dynamic-island.

## Principles
1. **Calm before clever.** Our users are tired. One job per screen, short words, big targets
   (≥ 44 px), nothing that moves without a reason, nothing that times out on them.
2. **Separated by tone and space, not outlines, gradients or colour.** Surfaces step up in tone;
   hairlines are rare; the accent is a highlighter, never a block.
3. **Leafy is the only illustration.** Pixel art stays pixel art (`image-rendering: pixelated`);
   the UI chrome around it is clean and modern. No emoji as icons.
4. **Honest copy.** No invented stats, testimonials, integrations, or medical claims. Speech
   analytics are "not a diagnosis". Privacy claims must match the code.
5. **Voice states are unmistakable** — listening, thinking, acting, speaking, done and error each
   differ in shape and motion, never by colour alone, and always show the words Rivertide heard.

## Tokens
Use CSS variables only — no raw hex in components.

```css
/* dark (default) */
--bg: #0b0c0b;            --bg-raised: #101211;
--surface-1: #151716;     --surface-2: #1b1d1c;    --surface-3: #232624;   --surface-4: #2c2f2d;
--ink: #f2f4f1;           --ink-muted: rgb(242 244 241 / .64);
--ink-faint: rgb(242 244 241 / .42);               --ink-ghost: rgb(242 244 241 / .24);
--hairline: rgb(255 255 255 / .08);                --hairline-strong: rgb(255 255 255 / .14);
--accent: #8fd27a;        /* Leafy body green */   --accent-strong: #5cbf4a;  /* leaf */
--accent-ink: #0d1f0b;    /* text on accent */      --accent-soft: rgb(143 210 122 / .14);
--ask: #ff8a3d;           /* ctrl+fn "ask" mode marker (continuity with the original orange) */
--warn: #e9a21a;          --danger: #ff6b8a;        --info: #7cc4ff;
--focus: #c8f2ad;         /* focus ring, 2px + 2px offset, appears instantly */

/* light "paper" chapter (website sections, optional app theme) */
--bg: #f5f5f2; --surface-1: #ffffff; --surface-2: #eeeee9; --ink: #111311;
--ink-muted: #5c605c; --hairline: rgb(17 19 17 / .10); --accent: #3f8f35; --accent-ink: #ffffff;
```

Radii: pill `999px` · control `12px` · card `18px` · panel `24px` · keycap `12px` (one system).
Shadows: none on flat UI; lifted objects only (keycaps, floating windows):
`inset 0 1px 0 rgb(255 255 255 / .07), 0 28px 44px -20px rgb(0 0 0 / .9)`.

## Type
- **Display:** Inter (variable), weight 400 for editorial headlines, 600–700 for UI titles,
  tracking `-0.035em` to `-0.05em`, line-height 1.02–1.12, `text-wrap: balance`, ≤ 7 words.
  Two-beat headlines: second beat in `--ink-faint` (e.g. "You speak naturally. / Rivertide writes clearly.").
- **Body:** Atkinson Hyperlegible Next, 16–17 px, line-height 1.6–1.7, max 62ch, `--ink-muted`.
- **Mono / keys:** JetBrains Mono for keycaps, shortcuts and tiny labels (11 px, +0.12em, sentence case preferred).
- Numbers: `font-variant-numeric: tabular-nums`. Weight ladder capped at 700.
- Fonts are bundled locally (`@fontsource*`), never fetched at runtime in the app.

## Motion
- Easing `--ease: cubic-bezier(0.22, 1, 0.36, 1)`; `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`.
- Springs: `{ type: 'spring', bounce: 0, duration: 0.4 }`. Island springs port jhaemin's
  react-spring configs (`tension→stiffness`, `friction 26→damping 26`, same `mass`).
- Durations: micro 120 ms · colour 160 ms · panel 240 ms · materialize 320 ms
  (`scale .97 + blur 6px → none`) · unblur 520 ms · reveal 700 ms (`translateY 10px → 0`, once).
- Loops must stop (floating objects drift twice then rest). Leafy is the exception — it lives —
  but it holds still under reduced motion.
- `prefers-reduced-motion: reduce` → opacity-only, ≤ 150 ms, no parallax, no scroll-scripting.
- Only animate `transform`, `opacity`, `filter`. Never `transition: all`.

## Components (recipes)
- **Buttons:** primary = pill 44–48 px, `--ink` on `--bg` inverted (light pill, dark text) or
  `--accent` for the single most important action in a view; ghost = `rgb(255 255 255 / .07)` →
  `.12` on hover; `:active { transform: scale(.98) }`; hover effects inside `@media (hover:hover)`.
- **Cards:** `--surface-1`, radius 18, no border; hover brightens tone one step (no lift).
- **Segmented control:** track `rgb(255 255 255 / .05)`, thumb `--surface-4` sliding with a shared
  `layoutId` spring.
- **Keycap (`<Kbd>`):** `--surface-2`, radius 8–12, inset top highlight, mono label.
- **Icons:** lucide-react, `strokeWidth={1.75}`, 18–20 px, optionally inside 32 px chips
  (`radius 10`, `rgb(255 255 255 / .07)`).
- **Toasts/status:** `aria-live="polite"`, never steal focus, stay until read for errors.
- **Empty states:** Leafy pose + one sentence + one action.

## Dynamic Island (shared component `@rivertide/island`)
Black (`#000`) capsule regardless of theme, white text, morphing between modes with springs and a
gooey split (SVG `feGaussianBlur` + alpha `feColorMatrix`, as in jhaemin/dynamic-island):
`compact` (idle pill) → `stretched` (leading + trailing slots) → `split` (pill + detached bubble)
→ `large` (expanded card with arbitrary content). Content cross-fades with `blur(4–5px)`,
`scale(.9)`, `opacity 0` → crisp, ~150–200 ms, delayed ~100 ms after the shape starts moving.

## Voice & copy
Short, declarative, human. Sentence case. Specific verbs ("Paste answer", not "Submit").
Errors say what happened and what to do — no "Oops", no exclamation marks.
Words to avoid: elevate, seamless, unleash, empower, supercharge, next-gen, revolutionize.
