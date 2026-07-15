# For Engineers

DomDom Inspector is a zero-configuration Chrome extension that surfaces computed design values — including token matching and rogue-value detection — on any React or non-React page.

---

## Core capabilities (v0.2.0)

### Design style inspector (Alt+Shift+I)

Hover over any element to read computed design values without opening DevTools:

- **Colors** — background, text, border with hex + oklch
- **Spacing** — margin and padding in px, with a rogue-value flag for values outside the 4/8 px grid
- **Border-radius** in px
- **Typography** — font-family, size, weight, line-height

When React is present in the page, the **component name** is shown as context (e.g. `MuiButton`, `ProductCard`, `other`). In production builds where debug names are stripped, a best-effort class name inference runs instead.

### Figma token matching

Paste a Figma Variables / W3C Design Tokens / Tokens Studio JSON into the popup. The badge annotates each value:

- **Token name** (green) — if the value matches a known token
- **Rogue value** (orange) — if no token matches

This works on production without source maps.

### Rogue-value detection (`tokenLint.ts`)

Spacing values that fall outside the 4 px grid are flagged automatically, even without a token dictionary. This catches hardcoded values like `padding: 14px` that break grid consistency.

### Parent / child navigation

- `↑` — move selection to the parent element
- `↓` — move selection back to the child

Useful for reaching elements that are hard to hover precisely.

---

## Architecture notes (for trust)

The extension uses two content script worlds:

- **MAIN world** — runs in the same JS context as the page. Reads React's Fiber tree (when available) via `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Never sends data externally.
- **ISOLATED world** — bridges settings, tokens, and i18n from the browser extension API to the MAIN world via `window.postMessage`.

No data leaves the browser. No remote code is loaded. The extension is [auditable from source](https://github.com/BoxPistols/domdom-inspector).

---

## Works on production

- Design measurement (`computed style`) works on any build — no source maps needed
- Component names: available in dev builds (displayName), best-effort in production (function name inference)
- Source jump and render profiling are planned for future releases ([issues #6 and #4](https://github.com/BoxPistols/domdom-inspector/issues))

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+I` | Toggle inspect mode |
| `↑` / `↓` | Navigate to parent / child element |
| `Esc` | Exit inspect mode |

*(Shortcuts can be remapped at `chrome://extensions/shortcuts`)*
