# Background & Problem

## The situation

Modern product teams use React + MUI to build UIs fast. Design systems define colors, spacing, and typography in Figma as design tokens. But in practice, **the live product drifts from the design system** — and nobody has a good way to catch it before it ships.

---

## The pain points we observed

### 1. Designers can't inspect the live app

Browser DevTools are built for engineers. A designer who wants to check if a button uses `primary.main` or `#1565C0` has to open the Elements panel, dig through computed styles, and mentally parse CSS — there's no token-level abstraction.

**Result:** Designers file vague "doesn't look right" tickets. Engineers struggle to reproduce.

### 2. Engineers can't see *which* component is rendering

React DevTools shows the component tree, but clicking through it to find the component responsible for a specific pixel on screen is tedious. There's no hover-to-identify feature that respects the MUI component hierarchy.

**Result:** "Which component is this?" takes 5 minutes of guessing.

### 3. Render performance is a black box

React's built-in profiler shows render timings but doesn't tell you *why* a component re-rendered. Was it a prop change? A context update? A parent re-render? Getting that answer requires adding `console.log` or installing `why-did-you-render` as a dev dependency — and it only works in dev builds.

**Result:** Performance regressions go unnoticed until users complain.

### 4. Token drift accumulates silently

One-off color fixes (`#1a73e8` instead of `primary.main`), hardcoded spacing (`padding: 12px` instead of `spacing(1.5)`) — these accumulate PR by PR. Design review catches some; most slip through. By the time a design audit happens, hundreds of "rogue values" exist with no easy way to find them.

**Result:** Design system adoption is impossible to measure.

---

## What React Design Inspector solves

| Problem | Solution |
|---|---|
| Designers can't read DevTools | Design-mode view: color chips, spacing readout, border-radius — in plain language |
| "Which component is this?" | Hover overlay names the component + MUI variant instantly |
| Why did this re-render? | Per-component render reason tracking (PerformedWork + props diff) |
| Token drift is invisible | Paste your Figma token JSON → rogue values are flagged as badges on the element |
| Only works on localhost | Works on any site after one-click opt-in; full design inspection on production |

---

## Who built this and why

Built by [@BoxPistols](https://github.com/BoxPistols), a designer-turned-engineer who was tired of the gap between Figma and the browser. The goal is a tool that designers and engineers can both use to have the *same conversation* about the live product.
