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
- **Elevation is hairline-first.** A 1px `border-border` on `bg-card` defines a surface — that's
  the default (Level 0). Reach for a shadow (`shadow-1`) only when something genuinely _floats_
  (popover, tooltip, dragged card). Never a heavy drop shadow. See **Elevation & depth**.
- **The decorative accent palette is decoration only.** The sticker colors (`accent-teal`,
  `accent-pink`, …) are for dashboard dots / illustration tints / empty-state art — **never** a
  button, structural fill, or transport-mode badge. See **Decorative accent palette**.

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

**Type scale** — three anchors, YouTube-style (UDT-69): **12px** smallest general text,
**16px** content/reading text, **20px** titles. Every step is a Tailwind v4 default — there
are **no custom font-size tokens** and never a raw `text-[Npx]` literal (px doesn't respond
to the user font-scale setting; rem tokens do). `text-xs` (12px) is the **floor — nothing
goes smaller**. The old `text-3xs` (10px) / `text-2xs` (11px) tokens were retired in UDT-69.

| Class | Size | Typical use |
| ----- | ---- | ----------- |
| `text-xs` | 12px | the floor — captions, badges, dense table/chip meta, counters, mobile secondary text |
| `text-sm` | 14px | compact functional UI — buttons, form labels, inputs, table cells, nav/menu |
| `text-base` | 16px | **content / reading text (default)** — paragraphs, descriptions, dialog & card body, primary values |
| `text-lg` | 18px | card titles, section subheads |
| `text-xl` | 20px | **page & section titles (default)** |
| `text-2xl` | 24px | occasional larger hero title |
| `text-3xl`+ | 30px+ | dashboard KPI numbers (`font-bold`/`extrabold`) |

Reading content is `text-base` (16px); page & section titles are `text-xl` (20px). `text-sm`
(14px) is for compact functional chrome only — controls, labels, table cells, nav — **not** prose.
`text-xs` (12px) is the smallest size anywhere. **In dense areas, show hierarchy with
font-weight and `text-muted-foreground`, never a smaller size** — e.g. a `font-medium` /
`font-semibold` primary line over a `font-normal text-muted-foreground` secondary line, both
at `text-xs`.

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

Two distinct ramps — don't conflate them:

- **Status ramp** (`--status-pass` / `--status-warn` / `--status-fail`, + `--muted-foreground`
  for N/A) is what every chart uses **today** — pass/warn/fail bars and the checklist donut all
  read from it, so a slice's color always means the same thing as the same-colored badge.
- **Categorical ramp** `--chart-1..5` (navy `#1a3557` · teal `#0097a7` · green `#52aa4e` ·
  amber `#ffc107` · red `#f44336`) is reserved for **non-status** series — e.g. one color per
  transport mode or agency. It exists and is mapped (`bg-chart-1`, …) but is **not yet used**;
  reach for it only when a series isn't a pass/warn/fail measure. Use in order.

Full chart chrome rules (gridlines, tooltip, label sizes) live under **Charts & data-viz**.

### Decorative accent palette (สติกเกอร์ — UDT-72)

Borrowed from Notion's playful multi-color "sticker" set, these six add personality to the
dashboard **without ever structuring it**. They are **decoration only**: category dots,
illustration/section tints, empty-state art. **Never** a button, CTA, structural fill, focus
signal, or transport-mode badge — those stay on brand navy/teal (and the per-mode hues in
`badges.tsx`). Defined in both themes (brighter in `.dark`) and mapped in `@theme inline`.

| Token | Light hex | Typical use |
| ----- | --------- | ----------- |
| `--accent-sky` | `#62aef0` | category dot / tint |
| `--accent-purple` | `#9333ea` | category dot / tint |
| `--accent-pink` | `#db2777` | category dot / tint |
| `--accent-orange` | `#dd5b00` | category dot / tint |
| `--accent-teal` | `#2a9d99` | category dot / tint |
| `--accent-green` | `#1aae39` | category dot / tint |

Use as utilities: `bg-accent-teal/10`, `text-accent-pink`, a `size-2 rounded-full` dot with
`style={{ background: 'var(--accent-purple)' }}`, etc. Because they never carry meaning (unlike
the status ramp), pick them for _variety_, not semantics.

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

## Elevation & depth

Depth here is **barely-there** — the app already works this way, this just names the rule.

| Level | Treatment | Use |
| ----- | --------- | --- |
| **0 — Flat** | 1px `border-border` on `bg-card`, **no shadow** | the default. Every card, panel, filter bar, KPI tile. |
| **1 — Soft** (`shadow-1`) | soft multi-layer near-transparent shadow (`--elevation-1`) | genuinely floating surfaces — popovers, tooltips, dropdowns, a dragged card. |
| **2 — Elevated** (`shadow-2`) | deeper layered stack (`--elevation-2`) | modals / large overlays that must clearly lift off the page. |

- **Default to Level 0.** A hairline is enough to separate a card from the canvas; don't add a
  shadow just to make something "pop." Reference: the checklist donut's custom tooltip uses
  `shadow-1` (`components/charts/ChecklistItemPieChart.tsx`) — that's the intended Level-1 look.
- Shadows are built from several **near-transparent** layers (Notion-style), never one hard cast.
  Use the tokens (`shadow-1` / `shadow-2`); don't hand-roll `shadow-lg` / `shadow-xl`.
- **Dark mode** separates surfaces with border + a lighter `bg-card`, not shadow — the dark
  `--elevation-*` values are deliberately faint. Depth in dark comes from the surface step.

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
- **Canonical card:** there is no shared `<Card>` component (yet) — cards are built inline, so
  keep the recipe consistent: outer card `bg-card border-border rounded-xl border p-5`; nested
  sub-cards `border-border rounded-lg border p-3` (or `px-4`). Always `bg-card` + hairline, never
  a shadow at rest (see **Elevation & depth**). Don't invent per-card padding/radius, and never
  paint a card with inline hex — use the semantic tokens.
- **KPI / stat cards** — two legitimate recipes, pick by whether the number needs a status color:
  the **big tile** (`bg-card border-border rounded-xl border p-5`, icon chip
  `rounded-lg p-1.5 bg-{token}/10` + `text-{token}` icon, label `text-muted-foreground text-xs
  font-medium uppercase tracking-wide`, number `text-3xl font-bold`) for dashboard/overview
  KPIs; the plain **`StatCard`** (`components/shared/StatCard.tsx` — `rounded-lg p-4`, no icon,
  `text-2xl font-bold`) for a smaller summary row with no icon/status meaning. Import
  `StatCard`, don't re-copy its markup.
- **Whitespace is the grouping device.** Separate sections with space (`space-y-6` between major
  blocks, `gap-4` in grids), not heavy rules. Where a divider is needed, prefer a hairline
  (`divide-border divide-y`, `border-b`) over a boxed border. Let cards breathe on the canvas
  rather than crowding them — airy and scannable beats dense and framed.

---

## Component primitives

`components/ui/button.tsx` exists (CVA variants — `default`/`outline`/`secondary`/`ghost`/
`destructive`/`link`, sizes `default`/`xs`/`sm`/`lg`/`icon*`) but in practice almost every
button in the app is a hand-rolled `<button className="...">`, not this component — so
"consistent" means matching the recipe below, not passing a `variant`/`size` prop. **New
code should still prefer importing `Button`** where reasonable; where it isn't, copy one of
these exact class strings rather than inventing a new one:

| Role | Recipe |
| ---- | ------ |
| Primary CTA (save/submit, inline) | `bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium` |
| Primary CTA (small, field-level save) | `bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium` |
| Outline / Cancel / Close | `border-border rounded-lg border px-4 py-2 text-sm font-medium` |
| Chrome icon button (navbar, audit header) | `rounded-lg border p-1.5` + `border-border text-muted-foreground hover:bg-secondary hover:text-foreground` |
| Pagination prev/next | `border-border hover:bg-secondary rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40` |
| Table row action (edit/approve) | `rounded-lg px-3 py-1.5 text-xs` (outline or tinted per action's semantics) |

Focus state everywhere: `ring-3 ring-ring/50` + border color shift. Disabled: `opacity-50`,
no pointer events. Buttons nudge down 1px on `:active`.

Other available primitives: `input`, `select`, `dialog`, `sheet`, `dropdown-menu`, `alert`,
`tooltip`, `separator`, `skeleton`, `navigation-menu`, `sidebar`, `password-input`.
**Prefer `Dialog` over `Sheet`** for editors (established convention — see admin template editor).

---

## Navigation & active state

The current page must always be visible in nav chrome — never rely on hover alone.

- **Sidebar** (`components/sidebar/AppSidebar.tsx`): pass `isActive` to `SidebarMenuButton`,
  computed from `usePathname()` (exact match or a sub-path). The primitive already renders the
  active look (`data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground`) —
  it only needs the prop.
- **Audit-layout header tabs** (`app/(audit-layout)/layout.tsx`): chrome icon links use
  `--accent` (documented above as "highlights, active nav, focus accents") for the active
  state — `border-accent/30 bg-accent/10 text-accent` — vs. the default neutral outline.
- Route-matching helper: active on `pathname === href || pathname.startsWith(href + '/')`, so
  a detail sub-route still lights up its parent nav item.

---

## Tables

No shared `<Table>` component — every table is hand-built, so matching this recipe is what
"consistent" means here. Outer wrapper is the canonical card (`bg-card border-border
rounded-xl border`, optionally `themed-scrollbar overflow-x-auto` for a wide table).

- **Header row:** `border-border bg-secondary/30 border-b`, cells
  `text-muted-foreground px-3 py-2/2.5/3 text-left text-xs font-medium uppercase tracking-wide`.
  Always give the header a bottom border — never bg-only or border-only.
- **Body rows:** `border-border border-b last:border-0` (or `tbody.divide-border.divide-y` —
  pick one per table, don't mix) + `hover:bg-secondary/30 transition-colors` if the row is
  interactive. A non-interactive row skips the hover, not the divider.
- **Score/status color:** never re-derive the pass/warn/fail threshold inline — import
  `statusColor` from `components/checklist/ChecklistSummaryPanel.tsx` (`score >= 75` pass,
  `>= 50` warn, else fail) and use `style={{ color: statusColor(score) }}`.
- **Pagination:** see the button recipe table above — every pager uses the same prev/next class
  string, whatever the page's own copy for the item-count label.

---

## Icons

`lucide-react` only. Default size ~16px (`size-4` via button styles); in mobile chrome, icons
are set explicitly `size={13–15}`. Keep icon size consistent within a cluster.

---

## Charts & data-viz

`recharts` only. Charts carry the same **quiet chrome** as the rest of the UI — the data is the
figure, the frame recedes. The two shipped charts (`components/charts/StationBarChart.tsx`,
`ChecklistItemPieChart.tsx`) are the reference implementations.

- **Color:** fills come from tokens, never hex. Status series use the **status ramp**
  (`var(--status-pass/warn/fail)`, `var(--muted-foreground)` for N/A); a same-colored slice and
  badge must always mean the same thing. Non-status/categorical series use `--chart-1..5`.
- **Gridlines:** hairline only — `<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />`.
  Drop axis lines and tick lines (`axisLine={false} tickLine={false}`); the numbers carry the axis.
- **Text floor:** tick, legend, and tooltip text is **≥12px** (`fontSize: 12`) — the same 12px
  floor as everywhere else (UDT-69). Never smaller, even in a dense chart.
- **Tooltip:** prefer a small custom tooltip matching card chrome —
  `bg-card border-border rounded-lg border px-2.5 py-1.5 text-xs shadow-1`, with a
  `size-2 rounded-full` color dot next to the label (see `SliceTooltip`). It floats, so it earns
  its `shadow-1` (Level 1).
- **Legend:** for **many small repeated charts** (e.g. a ranked list of donuts), render **one**
  shared legend above the list rather than a legend per chart — see the exported `HistogramLegend`.
- **Shape:** bars round their top corners (`radius={[4,4,0,0]}`); donuts use an inner radius
  (`innerRadius="45%"`) with a small `paddingAngle`. Keep it restrained — no heavy 3D/gradients.

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
- Use the canonical card recipe and let hairlines + whitespace do the layout work.
- Keep chart text ≥12px and chart fills on the status/`--chart` tokens.
- Pull from the decorative accent palette for _decoration_ — dashboard dots, tints, empty states.

**Don't**
- Hardcode hex in components (existing badge hexes are legacy — don't add more).
- Add a `tailwind.config`, install UI libs, or use non-shipped font weights.
- Break the transport-mode / status color conventions above.
- Paint a CTA, structural fill, or mode badge in an accent-palette (sticker) color.
- Drop a heavy shadow (`shadow-lg`/`shadow-xl`) — use `shadow-1`/`shadow-2`, and only when a
  surface truly floats. A card at rest is a hairline, not a shadow.
- Set chart tick/legend/tooltip text below 12px.
