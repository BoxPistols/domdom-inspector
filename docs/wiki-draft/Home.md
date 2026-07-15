# DomDom Inspector

> **Chrome extension** that makes design values visible — hover any element to see color, spacing, radius, and typography, and match them against your Figma design tokens.  
> Free · Read-only · Works on any site · [Support the project ☕](Support-the-Project)

---

## What is this?

DomDom Inspector is a Chrome extension for **designers and engineers** working on any web app — React, MUI, Tailwind, CSS Modules, or plain CSS. Hover over any element to see its computed design values and verify them against your design system tokens, without touching source code or a local dev server.

---

## Pages

| Page | Summary |
|---|---|
| [Background & Problem](Background) | Why this tool was built and what pain it solves |
| [For Designers](For-Designers) | How designers use it to audit live products |
| [For Engineers](For-Engineers) | How engineers use it to debug design drift |
| [Competitive Landscape](Competitive-Landscape) | How it compares to React DevTools and others |
| [Support the Project](Support-the-Project) | Tip jar / donation options |

---

## Quick start

1. Install from [Chrome Web Store](https://github.com/BoxPistols/domdom-inspector) *(link after publish)*
2. Open any website
3. Press **Alt+Shift+I** to activate the inspector
4. Hover over any element — a badge shows its design values

*For non-localhost sites, click **Enable on this site** in the extension popup first.*

---

## Key features (v0.2.0)

- **Design badge** — computed color, spacing (margin/padding), border-radius, typography on hover
- **Rogue value detection** — spacing outside the 4/8 px grid is flagged automatically
- **Figma token matching** — paste your Figma Variables / W3C Design Tokens / Tokens Studio JSON; matched values show the token name, unmatched values flagged as rogue
- **Parent / child navigation** — `↑` / `↓` to reach nested elements
- **Works on production** — React (dev + production builds) and non-React pages alike
- **Bilingual** — English / Japanese, switches with the browser locale

Render profiling, component tree, source jump, and AI-assisted reports are planned for future releases ([issues #4–#9](https://github.com/BoxPistols/domdom-inspector/issues)).
