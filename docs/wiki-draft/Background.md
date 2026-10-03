# Background & Problem

## The situation

Modern product teams use React + MUI (or Tailwind, or CSS Modules) to build UIs fast. Design systems define colors, spacing, and typography as design tokens. But in practice, **the live product drifts from the design system** — and nobody has a good way to catch it before it ships.

---

## The pain points we observed

### 1. Designers can't inspect the live app

Browser DevTools are built for engineers. A designer who wants to check if a button uses `primary.main` or `#1565C0` has to open the Elements panel, dig through computed styles, and mentally parse CSS — there's no token-level abstraction.

**Result:** Designers file vague "doesn't look right" tickets. Engineers struggle to reproduce.

### 2. Engineers can't quickly identify which component owns a pixel

React DevTools shows the component tree, but clicking through it to find the component responsible for a specific pixel on screen is tedious. There's no hover-to-identify feature that presents design values alongside component context.

**Result:** "Which component is this, and what color is it actually using?" takes too long to answer.

### 3. Token drift accumulates silently

One-off color fixes (`#1a73e8` instead of `primary.main`), hardcoded spacing (`padding: 14px` instead of `spacing(1.5)`) — these accumulate PR by PR. Design review catches some; most slip through. By the time a design audit happens, hundreds of "rogue values" exist with no easy way to find them.

**Result:** Design system adoption is impossible to measure.

---

## What DomDom Inspector solves (v1)

| Problem | Solution |
|---|---|
| Designers can't read DevTools | Design badge on hover: color chips, spacing readout, border-radius — in plain language |
| Token drift is invisible | The page's own MUI theme is detected automatically → matched values show the token name, off-token values are flagged as rogue |
| Adoption can't be measured | The token coverage side panel aggregates match rates over the whole page, and highlights the elements behind each number |
| Only works on localhost | Works on any site after one-click opt-in; full design inspection on production |

**Shipped since the first draft of this page:** component names from React Fiber, "open in editor" source jump (React dev builds), automatic MUI theme extraction, and the coverage side panel. **Planned, not wired yet:** pasting your own token JSON ([#13](https://github.com/BoxPistols/domdom-inspector/issues/13)) and AI-assisted audit reports ([#11](https://github.com/BoxPistols/domdom-inspector/issues/11)).

---

## Who built this and why

Built by [@BoxPistols](https://github.com/BoxPistols), a designer-turned-engineer who was tired of the gap between design tools and the browser. The goal is a tool that designers and engineers can both use to have the *same conversation* about the live product — starting with the most universally useful piece: design value measurement.
