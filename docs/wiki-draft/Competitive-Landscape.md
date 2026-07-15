# Competitive Landscape

## TL;DR

DomDom Inspector occupies a niche that no existing tool fills: **design token verification on live (production) pages for both engineers and designers**, working on any CSS approach — MUI, Tailwind, CSS Modules, or plain CSS.

---

## Comparison

| Tool | Target user | Works on production | Token match | Rogue detection | Render profiling |
|---|---|---|---|---|---|
| **DomDom Inspector** | Engineers + Designers | ✅ | ✅ | ✅ | Planned (#4) |
| React DevTools (Meta) | Engineers | ✅ | ❌ | ❌ | ✅ (basic) |
| Reactime | Engineers | ❌ (dev only) | ❌ | ❌ | ❌ |
| VisBug | Designers | ✅ | ❌ | ❌ | ❌ |
| CSS Scan (paid) | Designers | ✅ | ❌ | ❌ | ❌ |
| Figma DevMode | Designers | ❌ (design only) | ✅ (one-way) | ❌ | ❌ |

---

## Why React DevTools isn't enough

[React DevTools](https://react.dev/learn/react-developer-tools) is the gold standard for React debugging — use it alongside DomDom Inspector, they are complementary. But it has two gaps:

1. **No design perspective.** It shows props and state but doesn't extract color, spacing, or typography in a way that's meaningful to a designer. There's no token-matching concept.
2. **Engineer-only UX.** A designer cannot productively use React DevTools without engineering context. The component tree is raw and overwhelming.

---

## Why VisBug / CSS Scan isn't enough

These tools read computed styles from the DOM — which DomDom Inspector also does. The difference:

1. **No token layer.** They can show you `color: #1565C0` but can't tell you whether that's `primary.dark` or a hardcoded rogue value. There's no way to paste your design token dictionary.
2. **No rogue-value detection.** They don't flag spacing that falls outside your grid.

---

## The uncontested space

The combination of:
- Computed style extraction (design values)
- Design token dictionary matching (Figma JSON, W3C, Tokens Studio)
- Rogue-value detection (grid lint)
- Production compatibility (no dev server required)
- Designer-friendly UX (no DevTools knowledge required)

...is not offered by any other free tool in the ecosystem as of 2026. The closest analogy is Figma's DevMode, but it works in the opposite direction (design → inspect, not live app → inspect), and it requires a Figma paid plan.

---

## Pricing comparison

| Tool | Price |
|---|---|
| **DomDom Inspector** | **Free** (tip optional) |
| React DevTools | Free |
| Reactime | Free |
| VisBug | Free |
| CSS Scan | $39 one-time |
| Figma DevMode | Included in Figma paid plans |
