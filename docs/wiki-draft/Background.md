# Background & Problem

## The situation

Modern product teams use React + MUI (or Tailwind, or CSS Modules) to build UIs fast. Design systems define colors, spacing, and typography in Figma as design tokens. But in practice, **the live product drifts from the design system** — and nobody has a good way to catch it before it ships.

---

## The pain points we observed

### 1. Designers can't inspect the live app

Browser DevTools are built for engineers. A designer who wants to check if a button uses `primary.main` or `#1565C0` has to open the Elements panel, dig through computed styles, and mentally parse CSS — there's no token-level abstraction.

**Result:** Designers file vague "doesn't look right" tickets. Engineers struggle to reproduce.

### 2. Engineers can't quickly identify which component owns a pixel

React DevTools shows the component tree, but clicking through it to find the component responsible for a specific pixel on screen is tedious. There's no hover-to-identify feature that presents design values alongside component context.

**Result:** "Which component is this, and what color is it actually using?" takes too long to answer.

### 3. Token drift accumulates silently

One-off color fixes (`#1a73e8` instead of `primary.main`), hardcoded spacing (`padding: 12px` instead of `spacing(1.5)`) — these accumulate PR by PR. Design review catches some; most slip through. By the time a design audit happens, hundreds of "rogue values" exist with no easy way to find them.

**Result:** Design system adoption is impossible to measure.

---

## What DomDom Inspector solves (v0.2.0)

| Problem | Solution |
|---|---|
| Designers can't read DevTools | Design-mode view: color chips, spacing readout, border-radius — in plain language |
| Token drift is invisible | Paste your Figma token JSON → rogue values are flagged as badges on the element |
| Only works on localhost | Works on any site after one-click opt-in; full design inspection on production |

**Coming in future releases:** component identity from Fiber (issue #4/#5), render profiling (issue #4), source jump (issue #6), MUI theme auto-extraction (issue #8), AI-assisted reports (issue #9).

---

## Who built this and why

Built by [@BoxPistols](https://github.com/BoxPistols), a designer-turned-engineer who was tired of the gap between Figma and the browser. The goal is a tool that designers and engineers can both use to have the *same conversation* about the live product — starting with the most universally useful piece: design value measurement.
