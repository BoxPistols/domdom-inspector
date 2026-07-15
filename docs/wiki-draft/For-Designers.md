# For Designers

DomDom Inspector gives designers superpowers in the browser — no engineering background required.

---

## Workflow: Auditing a deployed product

### Step 1 — Enable on the site

Click the extension icon → **Enable on this site**. This is a one-time click per domain. The extension never sends data anywhere; it only reads what's already in the page.

### Step 2 — Activate Inspect Mode

Press **Alt+Shift+I** (or click the toggle in the popup). Hover over any element — a badge shows:

- The **computed color** (background, text, border) as a hex chip
- **Spacing** values (margin, padding) in px, with a flag if they fall outside the 4/8 px grid
- **Border-radius** and **typography** (font-family, size, weight, line-height)
- When React is present: the **component name** as context (`MuiButton`, `ProductCard`, etc.)

### Step 3 — Read the badge

The badge shows design values in plain language:

```
Background:     #c62828  →  color/error  ✓
Padding:        12px  →  ⚠ rogue value (not on 4px grid)
Border-radius:  8px  →  spacing/sm  ✓
Font size:      16px
```

Rogue values (ones that don't match any design token) are highlighted. This tells you exactly where the implementation diverged from your design system.

### Step 4 — Match against your Figma tokens

1. Export variables from your Figma file (Plugins → Design Tokens → Copy JSON, or use W3C / Tokens Studio format)
2. Open the extension popup → paste JSON into the **Design Tokens** field → Save
3. The badge next to each value updates: token name shown for matches, "rogue" flag for mismatches

---

## Common designer use cases

**Pre-release design QA**
Walk through the staging build before launch. Flag rogue values as GitHub comments or Figma annotations. No DevTools knowledge required.

**Design system adoption audit**
Measure what percentage of color/spacing values on a page are token-matched vs. hardcoded. Gives you a concrete metric to bring to a sprint review.

**Handoff verification**
After a component is built, verify that the implementation matches the Figma spec — not just visually but at the token level.

**Stakeholder demos**
Screen-share with a PM and hover over the live product while explaining design decisions. The overlay makes abstract concepts concrete.

---

## What designers don't need to do

- Install Node.js or any dev tooling
- Access the source code
- Have the local dev server running
- Ask an engineer to "check that spacing for me"
