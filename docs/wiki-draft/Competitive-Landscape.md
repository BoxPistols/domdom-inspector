# Competitive Landscape

## TL;DR

React Design Inspector occupies a niche that no existing tool fills: **MUI-aware design token verification on live (production) React apps, for both engineers and designers**.

---

## Comparison

| Tool | Target user | Works on production | MUI-aware | Figma token match | Render profiling |
|---|---|---|---|---|---|
| **React Design Inspector** | Engineers + Designers | ✅ | ✅ | ✅ | ✅ |
| React DevTools (Meta) | Engineers | ✅ | ❌ | ❌ | ✅ (basic) |
| Reactime | Engineers | ❌ (dev only) | ❌ | ❌ | ❌ |
| VisBug | Designers | ✅ | ❌ | ❌ | ❌ |
| CSS Scan (paid) | Designers | ✅ | ❌ | ❌ | ❌ |
| Figma DevMode | Designers | ❌ (design only) | ❌ | ✅ (one-way) | ❌ |

---

## Why React DevTools isn't enough

[React DevTools](https://react.dev/learn/react-developer-tools) is the gold standard for React debugging and we recommend using it alongside this extension. But it has two gaps:

1. **No design perspective.** It shows props and state but doesn't extract color, spacing, or typography in a way that's meaningful to a designer. There's no token-matching concept.
2. **Engineer-only UX.** A designer cannot productively use React DevTools without engineering context. The component tree is raw and overwhelming.

React Design Inspector is complementary, not a replacement.

---

## Why VisBug / CSS Scan isn't enough

These tools read computed styles from the DOM — which React Design Inspector also does. The difference:

1. **No React awareness.** They can't tell you that the element is a `MuiButton` with `variant="contained"`. They see a `<button class="MuiButton-root ...">` and show you a wall of CSS.
2. **No token layer.** They can show you `color: #1565C0` but can't tell you whether that's `primary.dark` or a hardcoded rogue value.

---

## The uncontested space

The combination of:
- React Fiber traversal (component identity)
- Computed style extraction (design values)
- Design token dictionary matching (Figma JSON)
- Production compatibility
- Designer-friendly UX (no DevTools knowledge required)

...is not offered by any other tool in the ecosystem as of 2026. The closest analogy is Figma's DevMode, but it works in the opposite direction (design → inspect, not live app → inspect).

---

## Pricing comparison

| Tool | Price |
|---|---|
| React Design Inspector | **Free** (tip optional) |
| React DevTools | Free |
| Reactime | Free |
| VisBug | Free |
| CSS Scan | $39 one-time |
| Figma DevMode | Included in Figma paid plans |
