# DESIGN.md — Clearpage
### The design law for this codebase. Read before writing any UI code.

> This file follows the **DESIGN.md open format** introduced by Google Labs / Google Stitch (open-sourced April 2026).
> Spec: https://github.com/google-labs-code/design.md
>
> It serves two audiences equally:
> - **Humans** — every developer, contractor, or contributor who touches the UI
> - **AI coding agents** — Claude Code, Cursor, Copilot, or any agent writing UI for this project
>
> The YAML front matter (between the `---` fences below) contains the machine-readable design tokens.
> The prose sections that follow contain the reasoning — what the tokens mean, when to use them, and what is forbidden.
>
> **The tokens and rules in this file are not suggestions. They are constraints.**
> Deviating from them requires a written rationale committed alongside the change.

---

## ⚠️ DEVELOPER: DO THIS FIRST — Audit the Codebase

**Do not fill in the YAML token block below until you have done this.**

The tokens must reflect what already exists in the codebase — not invented values, not defaults, not assumptions.

Work through the following before touching any token value:

1. **Find all CSS custom properties / variables** in the codebase (`tokens.css`, `globals.css`, `theme.ts`, `tailwind.config.js`, or wherever they live). List every colour, font, and spacing value that is already defined and in use.

2. **Identify which fonts are already loaded** — check `<head>` tags, `@import` statements, font config files. Do not introduce a new font. Use what is there.

3. **Identify the primary colour** — the one used on the main CTA button and active/focus states. That is your accent. Everything else is neutral or semantic.

4. **Identify the background colour** — what the page actually renders as. If it is a flat, warm off-white, note its exact hex. If it is something else, note that. Do not change it to match an assumption.

5. **Identify the border radius pattern** — check existing inputs, buttons, cards. Pick the value that appears most. That is the canonical radius.

6. **Identify the spacing unit** — is the codebase on a 4px base or 8px base? Check padding and margin values across components to determine which.

7. **Fill in the YAML block below** using only values you found in steps 1–6. Where a value does not yet exist in the codebase (e.g. there is no defined error colour), note it as `TBD` and define it in a follow-up PR — do not invent it inline.

8. **Commit this file** to the root of the repository. Reference it from `README.md` (see Section 9).

---

```yaml
---
name: Clearpage

colors:
  # Fill in from the existing codebase — see audit instructions above.
  # Do not invent values. Extract them.
  primary:      "#0f6b66"    # from --color-accent
  background:   "#f5f3ee"    # from --color-canvas
  surface:      "#ffffff"    # from panel/input usage (bg-white variants)
  text-heading: "#101416"    # from --color-ink
  text-body:    "#101416"    # default body text token usage
  text-muted:   "#4a5659"    # from --color-muted
  border:       "#d6d9d2"    # from --color-border
  border-focus: "#0f6b66"    # focus border uses --color-accent
  error:        "#b91c1c"    # semantic red from text-red-700 usage

typography:
  # Fill in from the fonts already loaded in the project.
  # Do not add new fonts. Do not guess. Check the codebase.
  heading:
    fontFamily: "\"Cormorant Garamond\", Georgia, serif"
    fontWeight: "600"
    fontSize:   "3.75rem (text-6xl)"
  body:
    fontFamily: "\"Source Sans 3\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontWeight: "400"
    fontSize:   "1rem (16px)"

spacing:
  # Fill in based on the spacing unit found in the codebase (4px or 8px base)
  unit: "4px"
  scale: "4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96"

rounded:
  input:  "12px (rounded-xl)"
  panel:  "16px (rounded-2xl)"
  modal:  "16px (rounded-2xl)"
---
```

---

## 0. The Design Philosophy

**Clearpage does one thing per screen. With nothing to distract from it.**

This is not a preference. It is the product's identity. Every layout decision flows from it.

The canonical reference for all design decisions is the **first homepage screenshot** on record: a centred, full-viewport layout, a flat warm background, a large heading, a single subtitle line, and one input paired with one action button. Nothing else on the page.

This is not a "hero section". This IS the page. Keep that distinction in mind at all times.

---

## 1. Background

The page background is a **single, flat colour**. That is the complete background specification.

There are no gradients. There are no layered tones. There are no textures, noise overlays, mesh effects, or vignettes of any kind. The colour value comes from the `background` token in the YAML block above, which must be extracted from the existing codebase.

**Never use:**
- `background: linear-gradient(...)` — banned on all page-level backgrounds
- `background: radial-gradient(...)` — banned
- `background: conic-gradient(...)` — banned
- `background-image` of any kind at the page level
- Noise, grain, or texture overlays
- `backdrop-filter: blur()` — glassmorphism, frosted glass, any of it
- Animated backgrounds, shifting colours, or ambient motion

The flat background is not a compromise. It is a deliberate editorial choice. It is what creates the calm that makes the typography work.

---

## 2. Colours

The colour palette is small. That is intentional. Restraint is the design.

**Rules:**
- The `primary` token is the **only accent colour**. It appears on the CTA button and on input focus borders. Nowhere else.
- Do not introduce a second accent colour.
- Do not introduce blue, purple, or orange unless they are already in the existing codebase and in active use.
- Colour must not be used to create visual interest. Visual interest comes from typography and space.
- Every new colour introduced must have a written justification committed alongside the code change.
- Error and success colours are **semantic only** — they communicate state, never decoration.

---

## 3. Typography

**Do not change the fonts.** Check the codebase, identify what is already loaded and in use, and work with those. The font values in the YAML block must come from the existing codebase — not from a preference, not from a recommendation.

If the codebase has a heading font and a body font, use them as-is. If it only has one font across both, use it consistently for both. The role of typography here is to be calm, legible, and authoritative — not decorative.

**Rules:**
- The heading (product name / page title) must always be the largest typographic element on the page by a significant margin.
- The subtitle is always smaller, always lighter in colour, and always constrained in line length (~60 characters max).
- No bold on body copy unless it is a functional label.
- No underlines except on links, and only on hover.
- No tracking (letter-spacing) unless the font demonstrably requires it.
- No uppercase text for headings or section titles.

---

## 4. Layout

### 4.1 The Centred Viewport Rule

Every **primary page** layout must:
- Vertically and horizontally centre the main content group within the full viewport height.
- Use `min-height: 100vh` with flex or grid centring.
- The content group has a maximum width (use whatever the codebase has established, or `720px`–`760px` as a default). It has generous horizontal padding on both sides.
- The content group has no background of its own, no border, no shadow. It is just the content sitting on the flat page background.

Do not left-align the main content block on a primary page. Do not create a sidebar layout. Do not create a two-column layout for the primary purpose of a page.

### 4.2 Spacing

Use the spacing unit and scale from the YAML tokens — values extracted from what the codebase already uses. Do not invent new spacing values. Do not use arbitrary pixel values in component styles.

When in doubt, add more space. Whitespace is the design.

### 4.3 Input + CTA Button

- Input and CTA button sit on the same horizontal row on desktop.
- On mobile (`< 640px`): stack vertically, input above button, both full width.
- Input takes roughly 65–70% of the row on desktop. Button takes the remainder.
- Border radius on both: use the `rounded.input` token.
- No icons inside the button. Text only.
- No ghost buttons, outline buttons, or secondary buttons in the primary action row.

---

## 5. Components

### 5.1 Text Input

- Background: `surface` token
- Border: `1.5px solid` using `border` token
- Border radius: `rounded.input` token
- Focus state: border colour changes to `border-focus` token. **That is the entire focus indicator.** No `box-shadow` glow ring. No blur. No outline other than the border colour change.

### 5.2 Primary CTA Button

- Background: `primary` token
- Text: white
- Border radius: `rounded.input` token (matches input)
- Hover: a darker shade of `primary` (darken by ~10–15%)
- Active: darker still
- No shadow. No glow. No scale transform on hover. The colour change is the complete feedback.
- Loading state: reduce opacity to `0.6`, disable pointer events. Plain text status line below the action row. No spinner inside the button.

### 5.3 Content Panels (Utility Pages)

For pages beyond the homepage that group denser content:
- Panel background: `surface` token (usually white)
- Border: `1px solid` using `border` token
- Border radius: `rounded.panel` token
- No shadow on the panel. The border is sufficient.
- Left-align content within the panel. Centre the panel on the page.

### 5.4 Modals / Dialogs

- Overlay: `rgba(0, 0, 0, 0.35)` — no blur on overlay
- Panel background: `surface` token
- Border: `1px solid` using `border` token
- Border radius: `rounded.modal` token
- Max-width: `480px`
- Entrance: `opacity` fade `0` → `1`, `200ms ease-out`. Nothing else moves.
- No slide-in from sides. No scale animation. No full-screen takeovers.

### 5.5 Links

- Colour: `primary` token
- No underline at rest. Underline on hover.
- Font weight matches the surrounding text. Do not bold links.
- Never use browser-default blue.

---

## 6. The One Purpose Per Page Rule

**This is the most important rule in this document.**

A page that already has one purpose gets nothing added to it. A new feature is a new route.

### What this means in practice:

- The homepage processes a single URL. The input and button are the entire page. **Nothing else belongs on it.**
- A batch URL tool → `/batch` (its own page)
- Analytics, usage counters, trust signals → `/stats` or `/dashboard` (its own page)
- Any other feature or tool → its own route

### How to decide when building something new:

Ask: *"Does this serve the exact same single purpose as the page it would live on?"*

If **yes** — it can live there.
If **no** — create a new route.

Navigation to other features can be added later via a minimal plain-text link in a footer. Even that requires discussion before implementation. The default for any primary page is: no navigation bar, no footer, no extra links. Earn each one.

---

## 7. What Is Explicitly Forbidden

Never implement any of the following. No exceptions without a written, committed rationale.

### On backgrounds and visuals
- Any gradient — `linear-gradient`, `radial-gradient`, `conic-gradient` — on any layer
- Glassmorphism, frosted glass, or `backdrop-filter: blur()` of any kind
- Decorative `box-shadow` on buttons, inputs, or content cards — shadows exist only for modal elevation and must be minimal
- Glow effects — coloured `box-shadow` on hover or focus states
- Noise, grain, or texture overlays
- Animated backgrounds
- Dark mode (out of scope unless separately commissioned)

### On layout
- Multiple sections stacked on the homepage
- Sidebar navigation
- Inline analytics, counters, or trust widgets on the homepage
- Marketing copy or "product features" sections on functional pages
- Appending a secondary feature below a primary one — create a route instead

### On components
- Ghost or outline CTA buttons as primary actions
- Colour-coded badges, bright label chips, or highlight tags used decoratively
- Icons used as decoration — only functional icons, plain and line-weight
- `border-radius` values that create pill shapes (unless that is what the codebase already uses — check first)
- Full-uppercase headings or section titles

---

## 8. Motion and Interaction

- Page load: a single `opacity` fade of the main content group. `350ms ease-out`. Nothing else moves.
- Component transitions: `180ms ease` maximum for colour or border changes.
- No idle animations — no bouncing, pulsing, rotating, or looping states on anything.
- No scroll-triggered animations — pages are simple enough that none are needed.
- `@media (prefers-reduced-motion: reduce)` must be respected on every transition, without exception.

---

## 9. Adding New Features — The Required Process

Before writing any UI code for a new feature:

1. Re-read Section 6. Determine if this feature needs a new route.
2. Confirm the page will use the `background` token — flat, no gradient.
3. Confirm the typography hierarchy matches what is defined in the YAML tokens.
4. Confirm the layout centres the content group on the viewport.
5. Use only components described in Section 5. If a genuinely new component type is needed, design it to match the restraint of what exists, add it to Section 5 of this file, and commit it alongside the implementation.
6. Before opening a PR, run through the checklist in Section 10.

---

## 10. Repository Setup

### README.md

Add the following to the project `README.md`:

```markdown
## Design
All UI decisions are governed by [DESIGN.md](./DESIGN.md).
Read it before writing any frontend code. No exceptions.
```

### CLAUDE.md (if using Claude Code)

If the project uses Claude Code, add the following to `CLAUDE.md` at the root:

```markdown
@design.md
```

This tells Claude Code to load the design system context at the start of every session, so it treats the tokens and rules as constraints — not suggestions.

### Linting (optional but recommended)

The `DESIGN.md` format supports automated linting via Google's open-source tooling:

```bash
npx @google/design.md spec --rules   # Validate this file
npx @google/design.md export --format tailwind DESIGN.md  # Export to Tailwind config
```

Spec and tooling: https://github.com/google-labs-code/design.md

### Versioning

Every change to this file is a design system change. Treat it like a breaking API change:
- Changes to token values require a PR, a description of what changed, and a note on what it affects.
- New tokens or new forbidden patterns require the same.
- No token value is changed inline without a review.

---

## 11. Pre-Ship Checklist

Confirm every item before any UI change is merged:

- [ ] The YAML tokens have been filled in from the existing codebase — no invented values, no TBD entries remaining.
- [ ] The page has **one primary purpose**. Not one plus a widget. Not one plus a section below.
- [ ] Background is the `background` token — flat, no gradient, no texture.
- [ ] No gradient, `backdrop-filter`, decorative shadow, or glow anywhere in the new code.
- [ ] The heading uses the `heading` font token, bold, near-black, large.
- [ ] Spacing uses values from the `spacing` scale — no arbitrary pixel values.
- [ ] CTA button uses the `primary` token, filled, no shadow.
- [ ] Input focus is a **border colour change only** — `border-focus` token, nothing else.
- [ ] No new colours introduced outside the defined token set.
- [ ] No new fonts introduced.
- [ ] Content group is **centred on the viewport**.
- [ ] No feature that belongs on its own route was added to an existing page.
- [ ] `prefers-reduced-motion` is respected on every transition.
- [ ] If a new component was built, it has been documented in Section 5 of this file.
- [ ] This checklist was reviewed before the PR was opened.

---

*Last updated: April 2026. Owner: Product / Design.*
*All deviations require a written rationale committed to the repository alongside the change.*
*Format spec: https://github.com/google-labs-code/design.md*
