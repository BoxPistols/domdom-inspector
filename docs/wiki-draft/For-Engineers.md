# For Engineers

React Design Inspector is a zero-configuration DevTools extension that gives you Fiber-level visibility into any React app — including production builds.

---

## Core capabilities

### Component identification (Alt+Shift+I)

Hover over any element to see the full React component name resolved from the Fiber tree — not just the DOM tag. This resolves through HOCs and portals to show the meaningful component name.

In dev builds: the overlay shows the **source file path** and **line number**. Click to open in your editor (VS Code or Cursor).

### Render profiler (Alt+Shift+R)

Tracks renders in real time without modifying your source. For each component:

- **Render count** since activation
- **Last render reason** — props changed / state changed / context changed / parent re-rendered / forced update
- **Props diff** — which specific prop changed between the last two renders
- **Render heatmap** — visual overlay coloring components by render frequency (blue → red)

This is equivalent to `why-did-you-render` but works on any build, including production.

### Component tree (Alt+Shift+T)

A collapsible tree of the full React Fiber tree for the current page. Click any node to:

- Inspect its current props and state
- See its render count
- Highlight it in the page overlay

### Design style extractor

For any element, reads computed styles and extracts:

- Colors (background, text, border) with hex + oklch
- Spacing (margin, padding) in px
- Border-radius
- Typography (font-family, size, weight, line-height)

Useful for quickly extracting values to file a precise bug report or verify a design spec without opening DevTools.

---

## Architecture notes (for trust)

The extension uses two content script worlds:

- **MAIN world** — runs in the same JS context as the page. Reads React's internal Fiber tree via `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Never sends data externally.
- **ISOLATED world** — bridges settings and i18n from the browser extension API to the MAIN world via `window.postMessage`.

No data leaves the browser. No remote code is loaded. The extension is [auditable from source](https://github.com/BoxPistols/react-design-inspector).

---

## Works on production

In production builds, React strips `displayName` and debug info. The extension handles this gracefully:

- Falls back to function name inference from the Fiber type
- Disables source jump (no source maps)
- Keeps render profiling fully functional (uses `PerformedWork` flag, not debug hooks)
- Keeps design style extraction fully functional (reads computed styles, not source)

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Alt+Shift+I | Toggle component inspector |
| Alt+Shift+R | Toggle render profiler |
| Alt+Shift+T | Toggle component tree |
| Esc | Exit any active mode |
