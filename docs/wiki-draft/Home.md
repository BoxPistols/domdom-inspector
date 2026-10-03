# DomDom Inspector

> **Chrome extension** that makes design values visible — hover any element to see color, spacing, radius, and typography, and match them against the design tokens the page itself provides. MUI themes are detected automatically; zero configuration.
> Free · Read-only · Works on any site · [Support the project ☕](Support-the-Project)

---

## What is this?

DomDom Inspector is a Chrome extension for **designers and engineers** working on any web app — React, MUI, Tailwind, CSS Modules, or plain CSS. Hover over any element to see its computed design values and verify them against the design system the page is built on, without touching source code or a local dev server.

---

## Pages

### For users (English)

| Page | Summary |
|---|---|
| [Background & Problem](Background) | Why this tool was built and what pain it solves |
| [For Designers](For-Designers) | How designers use it to audit live products |
| [For Engineers](For-Engineers) | How engineers use it to debug design drift |
| [Competitive Landscape](Competitive-Landscape) | How it compares to React DevTools and others |
| [Support the Project](Support-the-Project) | Tip jar / donation options |

### For maintainers (日本語)

Internal operations notes, kept in Japanese. No personal or credential information is ever stored here.

| ページ | 内容 |
|---|---|
| [Store Submission Steps](Store-Submission-Steps) | Chrome Web Store へ出展するまでの具体的手順 (登録 → 入力 → 審査 → 公開後) |

---

## Quick start

1. Install from [Chrome Web Store](https://github.com/BoxPistols/domdom-inspector) *(link after publish)*
2. Open any website
3. Press **Alt+Shift+I** to activate the inspector — or right-click any element and choose **"Inspect this element"**
4. Hover over any element — a badge shows its design values

*For non-localhost sites, click **Enable on current site** in the extension popup first.*

---

## Key features (v1)

- **Design badge** — computed text color, background, spacing (margin/padding), border-radius, and typography on hover
- **Token matching, zero config** — when the page uses MUI, the theme (palette / spacing / radius / font sizes) is read from its ThemeProvider automatically; matched values are annotated with the token name (e.g. `primary.main`)
- **CSS variable names** — on pages without a detectable theme, the badge still shows the CSS variable declared behind each value
- **Rogue value detection** — spacing that is not a multiple of 4 px is flagged automatically
- **Token coverage panel** — open the side panel from the popup to aggregate the same measurement over the whole page, with per-family match rates and "Show on page" highlighting
- **Open in editor** — Cmd/Ctrl+Click (or the right-click menu) jumps to the element's source (React dev builds)
- **Parent / child navigation** — `↑` / `↓` to reach nested elements
- **Works on production** — React (dev or production builds) and non-React pages alike
- **Bilingual** — English / Japanese, switches with the browser locale

The component tree and render profiling are **not** part of v1 — the implementation is kept in the repository but is deliberately unreachable and is not even included in the shipped JavaScript, because production builds strip component names, so a tree is unreadable exactly where this extension is meant to be used. Pasting your own token JSON is also planned but not wired yet ([#13](https://github.com/BoxPistols/domdom-inspector/issues/13)).
