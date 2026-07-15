# For Designers

React Design Inspector gives designers superpowers in the browser — no engineering background required.

---

## Workflow: Auditing a deployed product

### Step 1 — Enable on the site

Click the extension icon → **Enable on this site**. This is a one-time click per domain. The extension never sends data anywhere; it only reads what's already in the page.

### Step 2 — Activate Design Mode

Press **Alt+Shift+I** (or click the inspector icon in the popup). Hover over any element — a tooltip shows:

- The **component name** (`MuiButton`, `ProductCard`, etc.)
- The **computed color**, spacing, and border-radius values
- Whether the element is a **React component** or plain HTML

### Step 3 — Check a specific element

Click to lock the inspection on that element. The panel shows:

```
Color:          #1565C0  →  primary.dark  ✓
Background:     #FFFFFF  →  background.paper  ✓
Padding:        12px 16px  →  ⚠ rogue value (no token match)
Border-radius:  4px  →  shape.borderRadius  ✓
```

Rogue values (ones that don't match any design token) are highlighted. This tells you exactly where the implementation diverged from your design system.

### Step 4 — Match against your Figma tokens

1. Export variables from your Figma file (Plugins → Design Tokens → Copy JSON)
2. Click **Paste Tokens** in the inspector panel
3. The badge next to each value updates: green = matched token name, orange = rogue

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
