# DomDom Inspector

**English** | [日本語](./README.md)

[![CI](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml)

**Hover any element to see its design values — and match them against your design tokens.**
A zero-config Chrome extension for design measurement on any website: MUI, Tailwind, CSS Modules, or plain CSS.

## Features

- **Inspect mode** (`Alt+Shift+I`, exit with `Esc`) — hover any element to see a floating badge with its computed design values: text color, background, spacing (margin/padding), border-radius, typography
- **Rogue-value detection** — spacing that is not a multiple of 4px is flagged (`tokenLint.ts`), making design-system drift visible at a glance
- **Design token matching (zero config)** — on MUI pages the theme is auto-detected from `ThemeProvider`; matched values are annotated with the token name, unmatched values flagged as rogue with the nearest token (`muiTheme.ts` / `tokenDict.ts`)
- **MUI theme auto-detection** — when the page uses MUI, the theme (palette / spacing / border radius / font sizes) is read from its `ThemeProvider` and merged into token matching automatically — no JSON pasting needed (pasted tokens take precedence; toggle in the popup)
- **CSS variable names** — when a value is declared with a CSS variable (`var(--text)`), the badge shows the variable name so you can verify the UI is built on your design tokens; toggle to raw values in the popup
- **Open in editor** (zero-config since v0.4.23) — `⌘/Ctrl+Click` (or the context menu) opens the element's source in your editor. It goes through your **dev server's `/__open-in-editor`** endpoint (Vite / Next.js / CRA — the same route Vue DevTools uses), so there is no editor setting and no path mapping to configure. If no dev server answers, it falls back to the older editor URL scheme. Dev builds only; bundled/minified sources are detected and skipped. **What actually works where is measured in [`docs/editor-jump-support.md`](docs/editor-jump-support.md)**
- **Parent/child navigation** — `↑` moves to the parent element, `↓` back to the child; works on any site including plain HTML/CSS (DOM ancestry, not just React)
- **Works anywhere** — React apps (dev or production build) and non-React pages alike. When React is present, component names are shown as context (blue = MUI / green = your code / gray = other); design measurement itself never requires React
- **Bilingual** — English / Japanese UI, switches with the browser locale

> **Not in v1** — the component tree and render profiling (plus Page Vitals and the Markdown report) are **unwired from v1**. The implementation is kept in the repository (`src/render-bundle/`) but no shortcut or message path reaches it. Since v0.4.24 it is also **excluded from the shipped JS** — not merely unreachable, but not present at all (`pnpm check:submission` scans the built output and measures this on every run). Why: on production builds React minifies component names, so they are fundamentally unreadable; on dev builds React DevTools does the job better; and render visualization is already covered by the react-scan extension. Re-wiring is tracked in [`docs/ROADMAP.md`](./docs/ROADMAP.md) (restoring a mode means restoring the "4-point wiring" described in `CLAUDE.md`).

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

The extension only reads the page — it never stores page content and never executes remote code. **Nothing is sent to any third party.** It issues **two kinds** of network request, both addressed to your own local dev server: asking it to open a file in your editor, and fetching a source map so a bundled position can be mapped back to the original file. That request is made only when `looksLocalDev` is true (localhost / 127.0.0.1 / `*.local` / `*.test` …), and it carries nothing but the source path the page itself produced. See [`SECURITY.md`](./SECURITY.md) — that there is exactly one such route is measured on every run by `pnpm check:submission`.

### Supported environments (all measured in e2e)

`pnpm e2e`'s `editor-jump-matrix` records **what the extension actually tried to open**, in a
real browser, for each environment. Having the code is not the same as it working, so each
case is measured.

| Environment | Where the source location comes from | Jump | Setup |
|---|---|---|---|
| React 19 (Next + Turbopack / Vite) | Owner Stacks → source map | ✅ line and column | none |
| React 18 and earlier | `_debugSource` | ✅ line and column | none |
| Vue / Nuxt | `data-v-inspector` | ✅ line and column | dev server may need configuring |
| react-dev-inspector | `data-inspector-*` | ✅ line and column | same |
| Express / Rails and other server-rendered | `data-source` / `data-loc` … | ✅ if the server emits the attribute | same |
| Plain HTML / CSS | none | — opens nothing wrong; copies search hints instead | — |

**Design measurement (colors, spacing, radius, typography, rogue values, token matching) works
the same everywhere** — it only reads computed styles and never depends on a framework.

### One-time setup for "open in editor"

**Normally nothing to set up.** `⌘/Ctrl+Click` opens your editor. The only thing to do is
pick your editor in the popup's "Advanced" section (the default is Cursor).

The extension resolves the **absolute path of the original file** from source maps, so it can
open it directly through the editor's URL scheme — no dev-server configuration, no path mapping.

**Only when an absolute path cannot be resolved** (no source map, or React 18 and earlier
where only a relative path is available) does it fall back to the dev server. That path needs
the dev server to be told which editor to use, and the popup's "Advanced" section has a
permanent **"Copy the setup command"** button. Paste, run,
restart your dev server — done, once and for all.

Why the extension cannot do this for you: which editor the dev server launches is decided
**only by an environment variable on the server**. The endpoint takes no editor parameter,
and a browser cannot change the server's environment. All the extension can do is hand you
the correct line so you do not have to work it out.

| Editor | Setup |
|---|---|
| VS Code / Cursor / WebStorm | `export LAUNCH_EDITOR=code REACT_EDITOR=code` (or `cursor` / `webstorm`) |
| Anything else (e.g. Antigravity IDE) | the three lines below — this is what the button copies |

```sh
mkdir -p ~/.local/launch-editor
ln -sfn "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" ~/.local/launch-editor/code
export LAUNCH_EDITOR="$HOME/.local/launch-editor/code"
export REACT_EDITOR="$HOME/.local/launch-editor/code"
```

> **Two variables are needed.** Vite/webpack read `LAUNCH_EDITOR`; **Next.js only reads
> `REACT_EDITOR`** (measured against Next 16.3.0 on 2026-08-17). Setting only one makes the
> other framework silently do nothing.

`launch-editor` picks the argument form **from the editor's name**. Only `code` / `cursor` /
`codium` / `trae` / `vscodium` get `-g file:line:column`; any other name falls back to
passing the line and column as **extra file names**, so the file opens but the cursor does
not jump. Borrowing the name `code` fixes that. The shim is **not on your PATH**, so your
real `code` / `cursor` are untouched.

> **There is a second reason nothing opens.** The dev server resolves the path it receives
> against **its own working directory** (`path.resolve(cwd, file)`). In a monorepo, if the
> server was started from a different folder, the resolved path does not exist and
> `launch-editor` **returns silently** — the endpoint still answers 200. The extension's
> toast shows **the exact path it sent**, so if that path looks wrong, this is the cause.
>
> The value must not contain arguments — `LAUNCH_EDITOR="code --wait"` always fails.
> If you have `EDITOR="code --wait"` set (common for git), that is exactly why nothing opens;
> `LAUNCH_EDITOR` takes precedence, so the setup above resolves it.

Measurements and the full failure path: [`docs/editor-jump-support.md`](docs/editor-jump-support.md).

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
  popup/                Site enablement, mode toggle, editor settings, help
src/
  hook.ts        Piggybacks on __REACT_DEVTOOLS_GLOBAL_HOOK__ (never installs it)
  fiber.ts       Element info resolution (3-tier fallback: design-only / safe / dev)
  designStyle.ts Design value extraction from computed styles (pure functions)
  tokenDict.ts   Design token JSON parsing and matching (pure functions)
  tokenLint.ts   4px grid rogue-value detection (pure functions)
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
