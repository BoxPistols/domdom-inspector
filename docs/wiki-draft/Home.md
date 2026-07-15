# React Design Inspector — Wiki

> **Chrome extension** that bridges the gap between design and code for React / MUI applications.  
> Free & open to use · [Support the project ☕](Support-the-Project)

---

## What is this?

React Design Inspector is a Chrome DevTools extension for **engineers and designers** working on React apps built with Material UI (MUI). It lets you inspect components at the Fiber level, profile renders, and verify that the live UI matches your Figma design tokens — all without touching source code or requiring a local dev server.

---

## Pages

| Page | Summary |
|---|---|
| [Background & Problem](Background) | Why this tool was built and what pain it solves |
| [For Designers](For-Designers) | How designers use it to audit live products |
| [For Engineers](For-Engineers) | How engineers use it to debug renders and styles |
| [Competitive Landscape](Competitive-Landscape) | How it compares to React DevTools and others |
| [Support the Project](Support-the-Project) | Tip jar / donation options |

---

## Quick start

1. Install from [Chrome Web Store](#) *(link after publish)*
2. Open any React / MUI site
3. Press **Alt+Shift+I** to activate the inspector
4. Press **Alt+Shift+R** to open the render profiler

*For non-localhost sites, click **Enable on this site** in the extension popup first.*

---

## Key features at a glance

- **Component hover** — identify any MUI or custom React component by hovering
- **Component tree** — explore the full Fiber tree with props and state
- **Source jump** — open the component's source file in your editor (dev builds)
- **Render profiler** — see which components re-rendered and why (why-did-render style)
- **Design style inspector** — extract computed color / spacing / radius from any element
- **Figma token matching** — paste your token JSON and see which values match / which are "rogue"
- **Works on production** — no source maps needed for design inspection
