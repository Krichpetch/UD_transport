# UD Transport — Frontend Design System

> **Purpose:** the single visual reference for anyone building or editing UI in `apps/web`.
> The **source of truth** is `app/globals.css` (CSS variables) — this file documents and
> explains it. If a value here disagrees with `globals.css`, `globals.css` wins; fix this file.

## Golden rules

- **Never hardcode a hex color** in a component when a token exists. Use Tailwind utilities
  that map to the tokens (`bg-primary`, `text-muted-foreground`, `border-border`, …).
- **Tailwind v4 only** — no `tailwind.config`. Tokens are declared in `globals.css` under
  `:root` / `.dark` and exposed to Tailwind via the `@theme inline` block.
- **shadcn/ui only** for primitives (`@/components/ui/`), Lucide for icons. No MUI, no other kits.
- Both **light and dark** themes must work. Every color you introduce needs a `.dark` value.
- **No `localStorage`** for UI state (breaks in artifacts / SSR assumptions).

---

## Typography

**Font family:** LINE Seed Sans TH — **three locally-hosted static weights** (400 / 700 / 800,
`app/fonts/*.woff2`), loaded via `next/font/local` in `app/layout.tsx` and exposed as `--font-sans`.
It is _not_ a variable font — there is no weight axis. `--font-heading` currently aliases
`--font-sans` (headings use the same face, heavier weight).

Only three faces exist, so intermediate weights fall back via CSS font-matching (they are **not**
interpolated): `font-medium` (500) renders as the **400** face, `font-semibold` (600) renders as
the **700** face. Practically, `font-medium` looks identical to `font-normal` here — reach for
`font-bold` when you need real emphasis. Don't use `font-light`.

| Token / class | Weight | Renders as | Use |
| ------------- | ------ | ---------- | --- |
| `font-normal` | 400 | 400 | body text, table cells, inputs |
| `font-medium` | 500 | 400 (fallback) | buttons, badges, labels |
| `font-semibold` | 600 | 700 (fallback) | section headers |
| `font-bold`   | 700 | 700 | headings, emphasis, KPI numbers |
| `font-extrabold` | 800 | 800 | large display numbers, hero figures |

**Language:** UI copy is **Thai** (`<html lang="th">`). Keep line-heights comfortable for Thai
glyphs (tall ascenders/descenders) — prefer `leading-relaxed` on paragraphs.

**Type scale** — stick to these steps. `text-xs`…`text-3xl` are Tailwind defaults; `text-3xs`
and `text-2xs` are **custom rem tokens** defined in `globals.css` `@theme` (`--text-3xs` /
`--text-2xs`). They are the **tokenized floor** — never use a raw `text-[Npx]` literal (px doesn't
respond to the user font-scale setting; rem tokens do).

| Class | Size | Typical use |
| ----- | ---- | ----------- |
| `text-3xs` | 10px | dense table/chip meta, mobile counters (smallest allowed) |
| `text-2xs` | 11px | dense secondary text, era chips, autosave status |
| `text-xs` | 12px | badges, table meta, captions, mobile secondary text |
| `text-sm` | 14px | default body, form labels, most UI text |
| `text-base` | 16px | emphasized body, dialog body |
| `text-lg` | 18px | card titles, section subheads |
| `text-xl`–`text-2xl` | 20–24px | page titles |
| `text-3xl`+ | 30px+ | dashboard KPI numbers (`font-bold`/`extrabold`) |

Default UI text is `text-sm`; drop to `text-xs` for dense tables and mobile chrome, and
`text-2xs`/`text-3xs` only for the densest chips/counters.

> **Font scale (UDT-52):** users can set a root font-size of 100 / 125 / 150% (Settings →
> ขนาดตัวอักษร), stored in the `font-scale` cookie and applied to `<html data-font-scale>` in
> `app/layout.tsx` (SSR, no flash). Because the whole scale is rem-based, everything enlarges
> proportionally — which is why arbitrary `px` font sizes are banned.

---

## Color tokens

All colors are CSS variables in `app/globals.css`. Reference them through Tailwind semantic
classes, never by hex. Table below is the **light** theme; each has a `.dark` counterpart.

### Core surface & brand

| Token | Light hex | Meaning / usage |
| ----- | --------- | --------------- |
| `--background` | `#f5f7fa` | app canvas (`bg-background`) |
| `--foreground` | `#1a2744` | default text (`text-foreground`) |
| `--card` / `--popover` | `#ffffff` | raised surfaces, dialogs, dropdowns |
| `--card-foreground` | `#1a2744` | text on cards |
| `--primary` | `#1a3557` | brand navy — primary buttons, key actions |
| `--primary-foreground` | `#ffffff` | text on primary |
| `--secondary` | `#eef2f7` | subtle fills, secondary buttons, track backgrounds |
| `--secondary-foreground` | `#1a3557` | text on secondary |
| `--accent` | `#0097a7` | teal — highlights, active nav, focus accents |
| `--accent-foreground` | `#ffffff` | text on accent |
| `--muted` | `#64748b` | muted surface fills (`bg-muted`); dark: `#334155` |
| `--muted-foreground` | `#475569` | de-emphasized/secondary text, placeholders, icons (`text-muted-foreground`); dark: `#94a3b8` |
| `--border` / `--input` | `#e2e8f0` | dividers, card borders, input outlines |
| `--ring` | `#0097a7` | focus ring (teal) |

### Brand gradient

The signature UD Transport gradient (login, auditor shell, brand headers):

- `--theme-gradient-start`: `#193557` (navy) → `--theme-gradient-end`: `#0193a4` (teal)
- Available as Tailwind colors `theme-gradient-start` / `theme-gradient-end`.
- Usage: `bg-gradient-to-br from-theme-gradient-start to-theme-gradient-end`.

### Status colors (semantic — same in scoring, badges, charts)

| Token | Light hex | Meaning | Thai status label |
| ----- | --------- | ------- | ----------------- |
| `--status-pass` | `#52aa4e` | pass / meets standard | ผ่านมาตรฐาน |
| `--status-warn` | `#ffc107` | needs improvement | ต้องปรับปรุง |
| `--status-fail` / `--destructive` | `#f44336` | fail / destructive | ไม่ผ่าน |
| `--status-warn-foreground` | `#b38600` | readable warn **text** (amber is unreadable on light tints) | — |

Each has a brighter `.dark` variant. All four are mapped in `@theme inline`, so use them as
utilities: `bg-status-pass`, `text-status-fail`, `bg-status-warn/10 text-status-warn-foreground`,
etc. In JS/inline styles use the raw var: `color: 'var(--status-pass)'`.

> Always use these tokens for pass/warn/fail — never raw hex. (`badges.tsx` was migrated to them.)

### Chart palette (`recharts`)

`--chart-1` navy `#1a3557` · `--chart-2` teal `#0097a7` · `--chart-3` green `#52aa4e` ·
`--chart-4` amber `#ffc107` · `--chart-5` red `#f44336`. Use in order; they double as the
status ramp for pass/warn/fail series.

### Sidebar (dashboard layout)

Dark navy sidebar with teal active state: `--sidebar` `#1a3557`, `--sidebar-foreground` white,
`--sidebar-primary`/`--sidebar-ring` teal `#0097a7`, `--sidebar-accent` `#24466f` (hover/active row).

---

## Domain color conventions

These are **product rules**, not just aesthetics — keep them consistent everywhere.

### Transport mode badges (`components/shared/badges.tsx` → `TransportBadge`)

Each mode has a distinct hue so it's scannable at a glance:

| Mode | Classes |
| ---- | ------- |
| ทางบก (land) | `bg-blue-50 text-blue-700` |
| ทางราง (rail) | `bg-purple-50 text-purple-700` |
| ทางน้ำ (water) | `bg-cyan-50 text-cyan-700` |
| ทางอากาศ (air) | `bg-orange-50 text-orange-700` |
| รถไฟ (train subtype) | `bg-purple-50 text-purple-700` |
| รถไฟฟ้า (metro subtype) | `bg-indigo-50 text-indigo-700` |

### Status badge (`StatusBadge`)

`rounded-full px-2 py-0.5 text-xs font-medium` with a 10%-tint background + solid text, via the
status tokens: `bg-status-pass/10 text-status-pass`, `bg-status-warn/10 text-status-warn-foreground`
(warn text uses the darkened-amber token for contrast), `bg-status-fail/10 text-status-fail`.

### Score → color (`ScoreBar`)

`score >= 75` → `var(--status-pass)` · `>= 50` → `var(--status-warn)` · else `var(--status-fail)`.
Use this exact threshold anywhere a raw score drives a color.

### cabinetPriority (มติ ครม.) items

Visually distinguish with a small "มติ ครม." tag when relevant (see root `CLAUDE.md`).

---

## Radius

Base `--radius: 0.625rem` (10px). Scale exposed via `@theme`:

| Token | Multiplier | ≈ |
| ----- | ---------- | -- |
| `rounded-sm` | ×0.6 | 6px |
| `rounded-md` | ×0.8 | 8px |
| `rounded-lg` | ×1.0 | 10px (default card) |
| `rounded-xl` | ×1.4 | 14px |
| `rounded-2xl` | ×1.8 | 18px |
| `rounded-3xl` / `4xl` | ×2.2 / ×2.6 | larger panels/hero |

Badges & pills use `rounded-full`. Buttons default to `rounded-md`.

---

## Spacing & layout

- **Spacing scale:** Tailwind default 4px step. Common gaps: `gap-1.5` (chrome), `gap-2`/`gap-3`
  (rows), `gap-4`/`gap-6` (sections). Card padding usually `p-4`–`p-6`.
- **Page containers** differ per layout shell:
  - `(dashboard-layout)` — sidebar + navbar; content is wide.
  - `(audit-layout)` — mobile-first: `mx-auto max-w-2xl px-4 py-6`, sticky blurred header
    (`bg-card/80 backdrop-blur`), `bg-background` shell.
  - `(auth)` — centered card on the brand gradient, no chrome.
- **Icon buttons** in chrome: `rounded-lg border p-1.5`, muted → hover `bg-secondary`.
- **Sticky headers:** `sticky top-0 z-30` + `backdrop-blur` + translucent `bg-card/80`.
- **Scrollbars:** add class `themed-scrollbar` to on-theme scroll containers (thin, rounded,
  muted thumb) — see `globals.css`.

---

## Component primitives

Buttons come from `components/ui/button.tsx` (CVA variants). Use these, don't reinvent:

**Variants:** `default` (primary navy) · `outline` · `secondary` · `ghost` · `destructive`
(red tint, not solid red) · `link`.
**Sizes:** `default` (h-9) · `xs` (h-6) · `sm` (h-8) · `lg` (h-10) · `icon` / `icon-xs` /
`icon-sm` / `icon-lg`.

Focus state everywhere: `ring-3 ring-ring/50` + border color shift. Disabled: `opacity-50`,
no pointer events. Buttons nudge down 1px on `:active`.

Other available primitives: `input`, `select`, `dialog`, `sheet`, `dropdown-menu`, `alert`,
`tooltip`, `separator`, `skeleton`, `navigation-menu`, `sidebar`, `password-input`.
**Prefer `Dialog` over `Sheet`** for editors (established convention — see admin template editor).

---

## Icons

`lucide-react` only. Default size ~16px (`size-4` via button styles); in mobile chrome, icons
are set explicitly `size={13–15}`. Keep icon size consistent within a cluster.

---

## Dark mode

Toggled by a `.dark` class on an ancestor (`@custom-variant dark`). Everything driven by tokens
flips automatically. When adding a color: define it in **both** `:root` and `.dark`. Dark theme
uses `#0f172a` bg / `#1e293b` cards, brighter accents (primary → `#60a5fa`, accent → `#22d3ee`),
and translucent white borders (`rgba(255,255,255,0.1)`).

---

## Do / Don't

**Do**
- Reach for a semantic Tailwind class (`bg-card`, `text-muted-foreground`) first.
- Add new shared colors as tokens in `globals.css` (both themes) + map in `@theme inline`.
- Keep Thai copy; respect role-based read-only rules (EXECUTIVE and admin station page).

**Don't**
- Hardcode hex in components (existing badge hexes are legacy — don't add more).
- Add a `tailwind.config`, install UI libs, or use non-shipped font weights.
- Break the transport-mode / status color conventions above.
