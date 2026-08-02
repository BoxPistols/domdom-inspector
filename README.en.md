# DomDom Inspector

**English** | [日本語](./README.md)

[![CI](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml)

**Hover any element to see its design values — and match them against your design tokens.**
A zero-config Chrome extension for design measurement on any website: MUI, Tailwind, CSS Modules, or plain CSS.

## Features

- **Inspect mode** (`Alt+Shift+I`, exit with `Esc`) — hover any element to see a floating badge with its computed design values: text color, background, spacing (margin/padding), border-radius, typography
- **Rogue-value detection** — spacing outside a 4/8px grid is flagged (`tokenLint.ts`), making design-system drift visible at a glance
- **Design token matching** — paste your Figma Variables / W3C Design Tokens / Tokens Studio JSON into the popup; matched values are annotated with the token name, unmatched values flagged as rogue (`tokenDict.ts`)
- **MUI theme auto-detection** — when the page uses MUI, the theme (palette / spacing / border radius / font sizes) is read from its `ThemeProvider` and merged into token matching automatically — no JSON pasting needed (pasted tokens take precedence; toggle in the popup)
- **Token coverage panel** — measure the whole screen and get a per-family match rate (color / spacing / radius / font size) with real counts, plus the values worth fixing first. Deterministic, no AI required (`coverage.ts`)
- **AI design audit (BYOK, optional)** — collect aggregated style values from the page, preview exactly what will be sent, and get an AI-written audit (rogue values, consolidation, next steps) using your own OpenAI / Gemini API key. Inert until you configure a key; hard-disable toggle for client work
- **CSS variable names** — when a value is declared with a CSS variable (`var(--text)`), the badge shows the variable name so you can verify the UI is built on your design tokens; toggle to raw values in the popup
- **Open in editor** (v0.3.0) — `⌘/Ctrl+Click` an element to open its source in your editor (Cursor / VS Code / Antigravity IDE / WebStorm). Dev builds only; bundled/minified sources are detected and skipped
- **Parent/child navigation** — `↑` moves to the parent element, `↓` back to the child; works on any site including plain HTML/CSS (DOM ancestry, not just React)
- **Works anywhere** — React apps (dev or production build) and non-React pages alike. When React is present, component names are shown as context (blue = MUI / green = your code / gray = other); design measurement itself never requires React
- **Bilingual** — English / Japanese UI, switches with the browser locale

> **Not in v1** — the component tree and render profiling (plus Page Vitals and the Markdown report) are **unwired from v1**. The implementation is kept in the repository (`src/treeView.ts`, `src/renderDebug.ts`, `src/renderTracker.ts`, `src/vitals.ts`, …) but no shortcut or message path reaches it. Why: on production builds React minifies component names, so they are fundamentally unreadable; on dev builds React DevTools does the job better; and render visualization is already covered by the react-scan extension. Re-wiring is tracked in [`docs/ROADMAP.md`](./docs/ROADMAP.md) (restoring a mode means restoring the "4-point wiring" described in `CLAUDE.md`).

## Setup

```sh
pnpm install
pnpm dev        # Development (launches Chrome with auto-reload)
pnpm build      # Output goes to .output/chrome-mv3
pnpm build:sync # build + copy real files to a sync folder (OneDrive etc.) for multi-PC sharing
pnpm bump:patch # Bump version by +0.0.1 (minor/major also available). Auto-reflected in manifest/zip
pnpm test       # Unit tests (vitest)
pnpm e2e        # Popup smoke tests (playwright, requires pnpm build)
```

Manual loading: after `pnpm build`, open `chrome://extensions` → enable Developer mode → "Load unpacked" → `.output/chrome-mv3`

### Multi-PC dev sync (OneDrive etc.)

`pnpm build:sync` copies the build output to a sync folder **as real files**, so multiple PCs can share the same unpacked extension (real copies are used because symlinks break under OneDrive sync).

- Target folder resolution order: `EXT_SYNC_DIR` environment variable → `EXT_SYNC_DIR` in `.env.local` → macOS auto-detection (used when `~/Library/CloudStorage/OneDrive-*/Extensions` resolves uniquely)
- On another PC / OS, write `EXT_SYNC_DIR=/path/to/OneDrive/Extensions` in `.env.local` (`.env.local` is not tracked by git)
- After syncing, on each PC open `chrome://extensions` → "Load unpacked" → `<sync folder>/domdom-inspector`. After updates, click the extension's reload button (⟳)

## Using on deployed sites

Permissions are minimized. Only `localhost` / `127.0.0.1` are enabled automatically by default:

1. Open the site you want to inspect, click the extension icon → **"Enable on current site…"** once
2. Inspecting starts right away (the permission is permanent for that origin from then on; it can also be revoked from the popup)
3. A toggle to allow all sites at once is also available in the popup (optional)

The extension only reads the page — it never stores page content or executes remote code. The only outbound path is the opt-in BYOK AI audit (aggregated style values only, with a mandatory pre-send preview). See [`SECURITY.md`](./SECURITY.md) for details.

## Shortcuts

- `Alt+Shift+I` — toggle inspect mode (rebindable at `chrome://extensions/shortcuts` via "Change toggle shortcut" in the popup)
- `⌘/Ctrl+Click` — open the element's source in your editor (dev builds only)
- `↑` / `↓` — move selection to parent/child elements
- `Esc` — exit inspect mode

The popup shows the actual bindings from `chrome.commands.getAll()` in OS-native notation (⌥⇧I on Mac).

## i18n

English (`default_locale`) and Japanese via `chrome.i18n`, switching automatically with the browser's UI language.
- Catalogs: `public/_locales/{en,ja}/messages.json` (single source of truth)
- The MAIN world cannot use extension APIs, so the bridge (ISOLATED) resolves strings via `browser.i18n` and injects them via postMessage. English defaults live in code, so everything works even before resolution
- The popup fills strings via `data-i18n` attributes; help shows the English/Japanese block matching the UI language

## Store distribution (Chrome Web Store)

Intended for unlisted distribution. **Every publishing step is consolidated in [`PUBLISHING.md`](./PUBLISHING.md).** Listing copy and permission-justification drafts are in `STORE_LISTING.md`; the privacy policy text is in `PRIVACY.md`. Icons are in `public/icon/{16,32,48,96,128}.png`.

Build the distribution zip with `pnpm zip` (→ `.output/domdom-inspector-<version>-chrome.zip`).

## Architecture

```
entrypoints/
  inspector.content.ts  MAIN world / document_start. Establishes the hook + inspector core
  bridge.content.ts     ISOLATED world. Relays settings/tokens/toggle commands + injects i18n
  background.ts         Keyboard shortcuts → toggle commands to tabs
  popup/                Site enablement, token pasting, display settings, AI audit, help
src/
  hook.ts        __REACT_DEVTOOLS_GLOBAL_HOOK__ shim (installed before React loads)
  fiber.ts       Element info resolution (3-tier fallback: design-only / safe / dev)
  designStyle.ts Design value extraction from computed styles (pure functions)
  tokenDict.ts   Design token JSON parsing and matching (pure functions)
  tokenLint.ts   4/8px grid rogue-value detection (pure functions)
  classify.ts    MUI / first-party / third-party classification (pure functions)
  overlay.ts     Shadow-DOM-isolated highlight / design badge
  inspector.ts   Inspect mode state machine
```

Element info resolves with a 3-tier fallback: no React → computed styles only (`isReact:false`) / production React → class-name inference + design values / dev React → component names also resolved. **Design measurement does not depend on React.**

### Known limitations

- On production builds, first-party component names are fundamentally unavailable (design measurement works on all builds)
- RSC (Server Components) have no client-side Fiber, so component names are out of scope for them
- Sandboxed iframes (opaque origin) are not injected (blob/srcdoc iframes are supported)

## Documents

| Purpose | File |
|------|---------|
| Development guide (architecture / conventions / pitfalls / test strategy) | [`CLAUDE.md`](./CLAUDE.md) |
| Security (audit evidence / threat model / permission justification) | [`SECURITY.md`](./SECURITY.md) |
| Distribution (A: local zip / B: Chrome Web Store) | [`PUBLISHING.md`](./PUBLISHING.md) |
| Store listing & privacy | [`STORE_LISTING.md`](./STORE_LISTING.md) / [`PRIVACY.md`](./PRIVACY.md) |
| Phase plan (future features) | [`docs/ROADMAP.md`](./docs/ROADMAP.md) |
