# Design Audit (Section 11) — 2026-04-26

This file records checklist failures found before remediation.
Remediation pass completed on 2026-04-26:
- PASS: `app/page.tsx` now contains only heading, subtitle, input, and primary button for homepage mode.
- PASS: Global/app/component gradients, blur layers, glow rings, decorative shadows, and translational hover/loading motion removed from audited files.
- PASS: Batch page remains on dedicated route; homepage does not contain batch/trust widgets.
- PASS: Focus states on audited inputs/textarea are border-color-only.
- PASS: Individual E2E suites and full E2E suite are green after remediation.

## app/page.tsx (Homepage)
- FAIL: One purpose per page. Homepage includes extra trust/ticker and secondary navigation link.
- FAIL: Homepage includes additional loading panel (`ProgressIndicator`) beyond heading/subtitle/input/button.

## app/globals.css (Global)
- FAIL: Background is not flat. Uses layered radial gradients.
- FAIL: Dark-mode override adds additional gradient/background behavior.

## app/batch/page.tsx + components/BatchUrlPanel.tsx
- FAIL: Decorative visual treatment present (`conic-gradient`) for progress circle.
- FAIL: Uses `backdrop-blur`.
- FAIL: Uses decorative shadows (`shadow-sm`).
- FAIL: Input focus ring/glow present (`focus:ring-*`).
- FAIL: Uppercase section title label (`URLS BLOCK`).

## app/admin/page.tsx
- FAIL: Decorative shadows on cards/panels (`shadow-sm`).
- FAIL: Multiple uppercase section labels (e.g., metric labels with `uppercase`).

## components/UrlInput.tsx
- FAIL: Focus ring/glow (`focus:ring-*`).
- FAIL: Input has decorative shadow (`shadow-sm`).

## components/FailureModal.tsx
- FAIL: Focus ring/glow on textarea (`focus:ring-*`).
- FAIL: Modal elevation shadow too strong (`shadow-2xl`), not minimal.

## components/ProgressIndicator.tsx
- FAIL: Decorative shadow (`shadow-sm`).

## components/ImageToggle.tsx
- FAIL: Decorative shadow (`shadow-sm`) on active option.

## components/ExportButton.tsx
- FAIL: Animated spinner inside button (`animate-spin`).
- FAIL: Hover translation transform (`hover:translate-y-[-1px]`).

## components/UsageTrustRing.tsx / components/UsageTickerBar.tsx
- FAIL: Contains decorative/forbidden visuals for homepage usage (conic gradients and/or extra trust UI not allowed on homepage under current constraint).
