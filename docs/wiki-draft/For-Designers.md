# For Designers

DomDom Inspector gives designers superpowers in the browser — no engineering background required.

---

## Workflow: Auditing a deployed product

### Step 1 — Enable on the site

Click the extension icon → **Enable on current site**. This is a one-time click per domain. The extension only reads what's already in the page — nothing you inspect is sent to us or to any third party (see [SECURITY.md](https://github.com/BoxPistols/domdom-inspector/blob/main/SECURITY.md) for the auditable details).

### Step 2 — Activate Inspect Mode

Press **Alt+Shift+I**, click the toggle in the popup, or right-click any element and choose **"Inspect this element"**. Hover over any element — a badge shows:

- The **computed colors** (text, background) as chips
- **Spacing** values (margin, padding) in px, with a flag if they are not a multiple of 4 px
- **Border-radius** and **typography** (font-family, size, weight, line-height)
- When React is present: the **component name** as context (`MuiButton`, `ProductCard`, etc.)

### Step 3 — Read the badge

The badge shows design values in plain language, for example:

```
Background:     #c62828  →  error.main  ✓
Padding:        14px  →  ⚠ rogue value (not on the 4px grid)
Border-radius:  8px
Font size:      16px
```

Values that match a design token are annotated with the token name; off-grid spacing is flagged. This tells you exactly where the implementation diverged from the design system.

### Step 4 — Token matching is zero config

If the page is built with MUI, the extension reads the theme (palette / spacing / radius / font sizes) **from the page itself** — there is nothing to set up or paste. On pages without a detectable theme, the badge still shows the **CSS variable name** declared behind each value, plus the off-grid spacing warnings.

*Pasting your own Figma / W3C token JSON is planned but not in the current release ([#13](https://github.com/BoxPistols/domdom-inspector/issues/13)).*

### Step 5 — Measure the whole page

Click **"Open coverage panel"** in the popup, then **"Measure this page"**. The side panel shows, per family (color / spacing / radius / typography), how many elements match the page's tokens — and lists the values that drift the most. **"Show on page"** highlights the elements behind a number, so you can verify every rate with your own eyes.

---

## Common designer use cases

**Pre-release design QA**
Walk through the staging build before launch. Flag rogue values as GitHub comments or Figma annotations. No DevTools knowledge required.

**Design system adoption audit**
Use the coverage panel to measure what percentage of color/spacing values on a page are token-matched vs. hardcoded. A concrete metric to bring to a sprint review — with on-page proof behind every number.

**Handoff verification**
After a component is built, verify that the implementation matches the spec — not just visually but at the token level.

**Stakeholder demos**
Screen-share with a PM and hover over the live product while explaining design decisions. The overlay makes abstract concepts concrete.

---

## What designers don't need to do

- Install Node.js or any dev tooling
- Access the source code
- Have the local dev server running
- Paste or maintain a token file — the theme is read from the page
- Ask an engineer to "check that spacing for me"
