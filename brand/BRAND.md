# Loomwright — Brand Guidelines

Spec in. Woven software out.

Loomwright is the AI software factory (opencode, OpenSpec, Graphify) and the GitHub org that hosts its repos.

## 1. Mark

A woven square: four vertical **warp** threads (the repos) crossed by two **weft** threads (specs and agents), alternating over and under. Many parts, one fabric.

- **Wordmark:** "Loomwright" in Fraunces SemiBold, tracking −1%. One word, capital L only.
- **Lockup:** mark left of wordmark; mark height ≈ cap height × 1.4; gap = 0.25 × mark width.
- **Clear space:** one thread width (⅛ of mark width) on every side.
- **Minimum size:** mark 16 px (digital), 6 mm (print). Below 32 px use the favicon variant (mark fills 86% of the tile).

### Variants

| Variant | Threads / Weft | Use on |
|---|---|---|
| On light | Indigo `#3B4BA8` / Madder `#C8553D` | Flax, Linen, white |
| On dark | Lilac `#8E9BEA` / Coral `#E0714F` | Ink |
| Mono ink | `#14172B` | Print, stamps, one-colour |
| Mono flax | `#F3EBDD` | Over indigo, photos, dark ground |
| Avatar indigo | Flax / Peach `#F6A98F` on Indigo | GitHub org avatar |
| Avatar ink | On-dark colours on Ink | Favicon, app icon |

### Don'ts

- No gradients, glows, shadows or outlines.
- No recolouring outside the table above.
- Don't rotate, skew, or change thread count/proportions.
- Don't place the mark on busy imagery; use mono flax or ink on a flat panel.

## 2. Colour

| Token | Hex | Role |
|---|---|---|
| Ink | `#14172B` | Text, dark ground |
| Warp indigo | `#3B4BA8` | Primary actions, links, brand ground |
| Madder | `#C8553D` | Graphics and the gate accent only |
| Madder text | `#A8402B` | Accent text, "blocked" state |
| Linen | `#E4D8C3` | Panels, secondary surfaces |
| Flax | `#F3EBDD` | Page ground |
| Lilac / Coral | `#8E9BEA` / `#E0714F` | Indigo/madder equivalents on Ink |

### Contrast (WCAG)

| Pair | Ratio | Passes |
|---|---|---|
| Ink on Flax | 14.9 | AA, AAA |
| Ink on Linen | 12.6 | AA, AAA |
| Indigo on Flax | 6.4 | AA |
| Flax on Indigo | 6.4 | AA |
| Madder text on Flax | 5.2 | AA |
| Flax on Madder text | 5.2 | AA |
| Lilac on Ink | 6.8 | AA |
| Coral on Ink | 5.6 | AA |
| Madder `#C8553D` on Flax | 3.7 | Large text / graphics only |
| Madder text on Linen | 4.3 | **Fails AA for body text**; use on Flax only |

Rules: one accent per view. Madder marks the single human gate (spec approval) and nothing else. Never rely on colour alone to convey state; pair with a label or icon.

## 3. Typography

| Role | Family | Weights | Notes |
|---|---|---|---|
| Headlines | Fraunces | 500, 600 | Line height 1.1, tracking −1% |
| Body / UI | Inter | 400, 500, 600 | Line height 1.5; 500 for labels |
| CLI / code | JetBrains Mono | 400, 500 | Versions, commands, paths |

Scale: 48 / 32 / 20 / 16 / 13 px. All three families are on Google Fonts (OFL); self-host for production.

## 4. Principles

| Principle | In practice |
|---|---|
| Interwoven | Many small parts, one result; grids, repeated rhythm |
| Quiet | Flax ground, ink text, one accent |
| Gated | Approval is the one loud moment (madder) |
| Honest | Flat colour, 2 px lines, no decoration that carries no meaning |

## 5. Components

| Item | Spec |
|---|---|
| Primary button | Indigo fill, Flax text, 600 weight, radius 12, min height 44 |
| Secondary button | Transparent, 2 px Ink border, Ink text, radius 12, min height 44 |
| Status pill | Radius full, 13 px/500; drafted = Linen + Ink, approved = Indigo + Flax, blocked = Madder text + Flax |
| Terminal block | Ink ground, radius 16, padding 24, JetBrains Mono 14/1.7; prompt `$` and `›` in Lilac, gate line in Coral |
| Radii | 12 (controls), 16 (cards), 24 (panels) |
| Spacing | 8 px grid |
| Touch targets | ≥ 44 px |

CLI voice: terse, lowercase verbs, present tense (`spec drafted · 3 repos in scope`, `awaiting spec approval`).

## 6. Naming (GitHub org)

- Org: `loomwright`; repos short and lowercase: `loomwright/cli`, `/agents`, `/specs`, `/templates`.
- npm scope: `@loomwright/*`; CLI binary: `loomwright`.
- Verify availability before launch: `curl -s -o /dev/null -w "%{http_code}\n" https://api.github.com/users/loomwright` (404 = free) and `npm view @loomwright/cli`.

## 7. Asset inventory (`icons/`)

| File | Size | Background | Use |
|---|---|---|---|
| `mark-on-light-{1024,512,128}.png` | square | transparent | Light surfaces |
| `mark-on-dark-{1024,512,128}.png` | square | transparent | Ink surfaces |
| `mark-mono-ink-{1024,512,128}.png` | square | transparent | One-colour, print |
| `mark-mono-flax-{1024,512,128}.png` | square | transparent | Over indigo/dark |
| `avatar-indigo-{1024,512}.png` | square | Indigo | GitHub org avatar |
| `avatar-ink-{1024,512}.png` | square | Ink | Alt avatar, app icon |
| `favicon-{16,32,48}.png`, `favicon.ico` | square | Ink | Browser tab |
| `apple-touch-icon-180.png` | 180 | Ink | iOS home screen |

Source of truth for the geometry: 80 × 80 grid; threads 10 wide at x = 12, 28, 44, 60 (y 6–74, radius 5); wefts 68 × 11 at x = 6, y = 20 and 48 (radius 5.5); over/under crossings separated by a 1 unit gap.
