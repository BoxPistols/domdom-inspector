# For Engineers

DomDom Inspector is a zero-configuration Chrome extension that surfaces computed design values — including token matching and rogue-value detection — on any React or non-React page.

---

## Core capabilities (v1)

### Design style inspector (Alt+Shift+I, or right-click → "Inspect this element")

Hover over any element to read computed design values without opening DevTools:

- **Colors** — text and background
- **Spacing** — margin and padding in px, with a rogue-value flag for values that are not a multiple of 4 px
- **Border-radius** in px
- **Typography** — font-family, size, weight, line-height
- `↑` / `↓` move the selection to the parent / child element; `Esc` exits

When React is present in the page, the **component name** is shown as context (e.g. `MuiButton`, `ProductCard`). Design measurement itself never requires React.

### Token matching — zero config

When the page uses MUI, the theme (palette / spacing / border radius / font sizes) is read from its ThemeProvider automatically; matched values are annotated with the token name (e.g. `primary.main`), and unmatched values are flagged as rogue with the nearest token. On pages without a detectable theme, the badge shows the **CSS variable name** declared behind each value instead.

This works on deployed production builds — no source maps or dev server needed for measurement. *Pasting your own token JSON is planned but not wired in the current release ([#13](https://github.com/BoxPistols/domdom-inspector/issues/13)).*

### Token coverage side panel

**"Open coverage panel"** in the popup aggregates the same per-element measurement over the whole page: per-family match rates, the values that drift the most (with the nearest token), and a **"Show on page"** button that highlights the elements behind a number. The result is held in memory only — never stored, never sent.

### Open in editor

Cmd/Ctrl+Click an element while inspecting (or use the right-click menu) to jump to its source. Works on **React development builds**; positions from bundled output are resolved back to the original file via the page's own source map, and pages that expose source attributes (Vue/Nuxt `data-v-inspector`, react-dev-inspector, server-rendered `data-source`) are supported too. On production builds the extension says why it can't jump instead of doing nothing.

### Rogue-value detection

Spacing values that are not a multiple of 4 px are flagged automatically, even without a token dictionary. This catches hardcoded values like `padding: 14px` that break grid consistency.

---

## Architecture notes (for trust)

The extension uses two content script worlds:

- **MAIN world** — runs in the same JS context as the page. Reads React's Fiber tree (when present) and the MUI theme, in memory only.
- **ISOLATED world** — bridges settings and i18n from the browser extension API to the MAIN world via `window.postMessage`.

**Nothing you inspect is sent to us or to any third party.** The extension has no backend. It issues exactly two kinds of network requests, both addressed to **your own local dev server** and only on local dev origins: (1) asking it to open a file in your editor, and (2) fetching a source map the page itself serves. No remote code is loaded. All of this is reproducible by grep — see [SECURITY.md](https://github.com/BoxPistols/domdom-inspector/blob/main/SECURITY.md), and the repository's `check:submission` script measures it on every push.

---

## Works on production

- Design measurement (`computed style`) and MUI token matching work on any build — dev or production, no source maps needed
- Component names: available in dev builds; best-effort in production (where React strips debug names)
- "Open in editor" needs a development build (that's where source positions exist)
- The component tree and render profiling are **not** part of v1: the implementation is kept in the repository but deliberately unreachable, and is not included in the shipped JavaScript at all

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+I` | Toggle inspect mode |
| `↑` / `↓` | Navigate to parent / child element |
| `Cmd/Ctrl+Click` | Open the element's source in your editor (dev builds) |
| `Esc` | Exit inspect mode |

*(Shortcuts can be remapped at `chrome://extensions/shortcuts`. No keyboard needed: the right-click menu covers inspect and editor jump.)*
