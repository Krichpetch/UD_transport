'use client'

import * as React from 'react'
import { Check, ChevronDown, ChevronRight, ListChecks, Search, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// Live feedback follow-up — a real (possibly nested) tree, not a pre-flattened list: A1's own
// preview holds exactly A1.1/A1.2/A1.3 as its direct children, and if one of THOSE (e.g. a tiered
// item like A1.1) has its own subItems, they nest one level deeper under IT, not merged into a
// single flat pile that loses which A1.X each grandchild actually belongs to.
export interface NavigatorLeafPreview {
  code: string
  labelTh: string
  children?: NavigatorLeafPreview[]
}

export interface NavigatorPage {
  code?: string
  label: string
  sublabel?: string
  answered: number
  total: number
  // Session S4a, Part D.2 — top-level group key (e.g. "A"/"B"/"C") + display label, v2/v3 only.
  // When ANY page carries this, the sheet renders grouped collapsible sections instead of one
  // flat list — a 77-container metro form is unnavigable as a single scroll. Absent for v1 (the
  // flat group-level list), which renders exactly as before.
  groupKey?: string
  groupLabel?: string
  // Live feedback follow-up — the item tree living INSIDE this page (v1: the group's own items;
  // v2/v3: the top-level item's subItems). Purely a browsing/search aid: this pager has no
  // navigable unit finer than a page, so tapping any node in this tree still jumps to THIS page,
  // same as tapping the page row itself — it just lets a page with many items (a big v1 group, or
  // a metro container) be scanned/searched without opening every page to remember what's inside
  // it. Absent/empty = nothing to preview, the row renders exactly as before.
  leafItems?: NavigatorLeafPreview[]
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase()

// Live feedback follow-up — the SECOND grouping tier: A -> A1 -> [A1.1, A1.2, A1.3], derived
// purely from each PAGE's own code (never from TemplateNode.subItems — these are separate PAGES,
// not one page's nested content, see leafTree below for that other case). "A1.1".split before the
// first dot -> "A1"; a v1 page's own code has no dot ("A1") and returns undefined, so v1 never
// bundles — its pages are already at this exact granularity, nothing to nest further.
function subGroupKey(code: string | undefined): string | undefined {
  if (!code) return undefined
  const dot = code.indexOf('.')
  return dot === -1 ? undefined : code.slice(0, dot)
}

// Depth-first search through a leaf-preview tree for the first node matching `needle` — a node at
// ANY depth, not just direct children, so e.g. a tiered sub-measurement three levels under A1
// still surfaces as a search hit for the A1 page.
function findMatchInTree(nodes: NavigatorLeafPreview[] | undefined, needle: string): NavigatorLeafPreview | undefined {
  if (!nodes) return undefined
  for (const n of nodes) {
    if (norm(n.code).includes(needle) || norm(n.labelTh).includes(needle)) return n
    const child = findMatchInTree(n.children, needle)
    if (child) return child
  }
  return undefined
}

// Live feedback follow-up — case-insensitive substring match against every piece of text a page
// carries, including its whole leaf-preview tree, so searching e.g. "ทางลาด" finds the page
// containing a ramp item even when the page's own label doesn't say "ramp". Returns which node
// matched (if the page itself didn't) so the result row can show that as context instead of just
// the page label.
function matchPage(p: NavigatorPage, needle: string): { hit: boolean; matchedLeaf?: NavigatorLeafPreview } {
  if (!needle) return { hit: true }
  const ownMatch = [p.code, p.label, p.sublabel, p.groupLabel].some((s) => norm(s).includes(needle))
  if (ownMatch) return { hit: true }
  const matchedLeaf = findMatchInTree(p.leafItems, needle)
  return { hit: !!matchedLeaf, matchedLeaf }
}

// Jump-to navigator for the auditor checklist form — a bottom sheet listing every page (v1:
// groups; v2: items) with a completion indicator, so the auditor isn't limited to prev/next.
// Trigger doubles as an at-a-glance "how many pages am I fully done with" counter.
export function PageNavigatorTrigger({
  pages,
  currentPage,
  onJump,
}: {
  pages: NavigatorPage[]
  currentPage: number
  onJump: (index: number) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const doneCount = pages.filter((p) => p.total > 0 && p.answered === p.total).length
  const grouped = pages.some((p) => p.groupKey !== undefined)

  // Session S4a, Part D.2 — which group sections are expanded. Re-synced to "just the group
  // containing currentPage" every time the sheet opens, so a long metro form always opens with
  // the auditor's current position visible, not every section collapsed or all of them expanded.
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set())
  // Live feedback follow-up — the leaf-preview tiers: which pages' own preview is expanded (keyed
  // by page index), and within an expanded preview, which individual NODES are further expanded
  // to reveal THEIR own children (keyed by code — TemplateNode.code is globally unique per
  // template, see @repo/types, so one flat Set safely covers every page's tree at once). Both
  // always collapsed on a fresh sheet open — this is a peek-inside affordance, not something worth
  // restoring state for.
  const [openLeaves, setOpenLeaves] = React.useState<Set<number>>(new Set())
  const [openLeafNodes, setOpenLeafNodes] = React.useState<Set<string>>(new Set())
  // The second tier (A -> A1 -> pages) — same "re-sync to current page's subgroup on open" rule
  // as openGroups above, so the auto-scroll effect below always finds a visible (non-collapsed)
  // row to scroll to. Keys are globally unique (they already carry the category letter, e.g.
  // "A1" vs "B1"), so one flat Set covers every category.
  const [openSubGroups, setOpenSubGroups] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    if (!open || !grouped) return
    const current = pages[currentPage]?.groupKey
    setOpenGroups(current !== undefined ? new Set([current]) : new Set())
  }, [open, grouped, pages, currentPage])
  React.useEffect(() => {
    if (!open) return
    const sk = subGroupKey(pages[currentPage]?.code)
    setOpenSubGroups(sk !== undefined ? new Set([sk]) : new Set())
  }, [open, pages, currentPage])
  React.useEffect(() => {
    if (!open) { setQuery(''); setOpenLeaves(new Set()); setOpenLeafNodes(new Set()) }
  }, [open])

  function toggleGroup(key: string) {
    setOpenGroups((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSubGroup(key: string) {
    setOpenSubGroups((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleLeaves(i: number) {
    setOpenLeaves((cur) => {
      const next = new Set(cur)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function toggleLeafNode(code: string) {
    setOpenLeafNodes((cur) => {
      const next = new Set(cur)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // Live feedback follow-up — scrolls the CURRENT page's own row into view every time the sheet
  // opens (grouped or not). Previously the sheet only scrolled its expanded SECTION into view,
  // landing on that section's first row — for a category with many pages (a big v1 group, or a
  // metro container) that meant scrolling manually past every earlier page to find the current
  // one. rAF-deferred so it runs after the section-expand/DOM-update above has actually painted.
  const currentRowRef = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    if (!open || query) return
    const id = requestAnimationFrame(() => {
      currentRowRef.current?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, query, openGroups, openSubGroups])

  // Recursive leaf-preview tree renderer — one row per node, its own chevron only when IT has
  // children (so A1's preview shows A1.1/A1.2/A1.3 directly, and if A1.1 itself has children, a
  // SEPARATE chevron on A1.1 reveals those a level deeper, never merged flat into A1's own list).
  // Every node still jumps to the same PAGE (index i) on tap — this pager has no finer navigable
  // unit, see NavigatorPage.leafItems' doc.
  function leafTree(nodes: NavigatorLeafPreview[], i: number, depth: number) {
    return nodes.map((n) => {
      const hasChildren = !!n.children && n.children.length > 0
      const nodeOpen = openLeafNodes.has(n.code)
      return (
        <div key={n.code}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onJump(i)
                setOpen(false)
              }}
              className="hover:bg-secondary/60 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-2 text-left"
            >
              <span className="bg-secondary text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">{n.code}</span>
              <span className="text-muted-foreground truncate text-xs">{n.labelTh}</span>
            </button>
            {hasChildren && !query && (
              <button
                type="button"
                onClick={() => toggleLeafNode(n.code)}
                aria-label="แสดงรายการย่อย"
                className="text-muted-foreground shrink-0 rounded-lg p-1.5 hover:bg-secondary/60"
              >
                <ChevronRight size={12} className={`transition-transform ${nodeOpen ? 'rotate-90' : ''}`} />
              </button>
            )}
          </div>
          {hasChildren && (query || nodeOpen) && (
            <div className="border-border ml-3 border-l pl-3">
              {leafTree(n.children!, i, depth + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  // Lowercase + called-as-a-function (not rendered as a JSX tag) so eslint's component-detection
  // heuristic (react/prop-types) doesn't treat this as a component needing its own prop types —
  // it's just a shared render helper for the two branches below, same as the rest of this file's
  // inline `pages.map((p, i) => …)` callbacks never needed one either.
  function pageRow(p: NavigatorPage, i: number, matchedLeaf?: NavigatorLeafPreview) {
    const done = p.total > 0 && p.answered === p.total
    const started = p.answered > 0 && !done
    const hasLeaves = !!p.leafItems && p.leafItems.length > 0
    const leavesOpen = openLeaves.has(i)
    return (
      <div key={i}>
        <div
          className={`flex w-full items-center gap-1 rounded-lg transition-colors ${
            i === currentPage ? 'bg-primary/10' : 'hover:bg-secondary/60'
          }`}
        >
          <button
            ref={i === currentPage ? currentRowRef : undefined}
            type="button"
            onClick={() => {
              onJump(i)
              setOpen(false)
            }}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-3 text-left"
          >
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm">
                {p.code && (
                  <span className="bg-secondary text-muted-foreground mr-1.5 rounded px-1.5 py-0.5 font-mono text-[11px]">{p.code}</span>
                )}
                {p.label}
              </p>
              {matchedLeaf ? (
                <p className="text-muted-foreground truncate text-xs">
                  พบใน: {matchedLeaf.code} {matchedLeaf.labelTh}
                </p>
              ) : p.sublabel && (
                <p className="text-muted-foreground truncate text-xs">{p.sublabel}</p>
              )}
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${
                done ? 'text-green-600' : started ? 'text-amber-600' : 'text-muted-foreground'
              }`}
            >
              {done ? <Check size={16} /> : `${p.answered}/${p.total}`}
            </span>
          </button>
          {hasLeaves && !query && (
            <button
              type="button"
              onClick={() => toggleLeaves(i)}
              aria-label="แสดงรายการย่อย"
              className="text-muted-foreground shrink-0 rounded-lg p-2 hover:bg-secondary/60"
            >
              <ChevronRight size={14} className={`transition-transform ${leavesOpen ? 'rotate-90' : ''}`} />
            </button>
          )}
        </div>
        {hasLeaves && (query ? !!matchedLeaf : leavesOpen) && (
          <div className="border-border ml-3 border-l pl-3">
            {leafTree(p.leafItems!, i, 0)}
          </div>
        )}
      </div>
    )
  }

  // Renders one SECOND-tier bundle (e.g. "A1" holding A1.1/A1.2/A1.3) — same collapsible-header
  // shape as the category header, one size down, so the visual hierarchy reads A > A1 > A1.1 at a
  // glance. Only ever called for a bundle with 2+ pages (see the singleton-collapse rule in
  // `sections` below) — a lone dotted code renders as a plain page row instead, no pointless
  // single-child header.
  //
  // Live feedback follow-up — the bundle's own name (e.g. "ที่จอดรถ" for "A1"), not just its bare
  // code: every page bundled under "A1" shares the SAME sublabel (groupDisplayName of their common
  // parent group, e.g. "(A1) ที่จอดรถ" — see buildNavPages), so the first row's sublabel already
  // carries it. Stripped of its own redundant "(A1) " prefix (already shown separately as the
  // bundle's own code) rather than shown twice.
  function subGroupBlock(sub: { key: string; rows: { p: NavigatorPage; i: number }[] }) {
    const isOpen = openSubGroups.has(sub.key)
    const done = sub.rows.filter(({ p }) => p.total > 0 && p.answered === p.total).length
    const rawSublabel = sub.rows[0]?.p.sublabel
    const codePrefix = `(${sub.key}) `
    const name = rawSublabel?.startsWith(codePrefix) ? rawSublabel.slice(codePrefix.length) : rawSublabel
    return (
      <div key={sub.key} className="mb-0.5">
        <button
          type="button"
          onClick={() => toggleSubGroup(sub.key)}
          className="hover:bg-secondary/60 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors"
        >
          <span className="min-w-0 truncate text-xs">
            <span className="text-foreground font-semibold">{sub.key}</span>
            {name && <span className="text-muted-foreground ml-1 font-normal">{name}</span>}
          </span>
          <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-[11px]">
            {done}/{sub.rows.length}
            <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {isOpen && (
          <div className="pl-1.5">
            {sub.rows.map(({ p, i }) => pageRow(p, i))}
          </div>
        )}
      </div>
    )
  }

  // Groups in first-seen order (matches the pager's own A1→A2→...→B1→... document order). Within
  // a category, sibling pages sharing a code prefix before the first dot get bundled into a
  // second-tier `entries` item (kind: 'subgroup') — but only when 2+ pages actually share that
  // prefix; a v1 page's own code has no dot (subGroupKey returns undefined) and a lone dotted code
  // stays a plain 'page' entry, so neither ever gets a pointless single-child header.
  const sections = React.useMemo(() => {
    if (!grouped) return []
    const order: string[] = []
    const byKey = new Map<string, { label?: string; rows: { p: NavigatorPage; i: number }[] }>()
    pages.forEach((p, i) => {
      const key = p.groupKey ?? ''
      if (!byKey.has(key)) { byKey.set(key, { label: p.groupLabel, rows: [] }); order.push(key) }
      byKey.get(key)!.rows.push({ p, i })
    })
    return order.map((key) => {
      const { label, rows } = byKey.get(key)!
      const subOrder: string[] = []
      const subRows = new Map<string, { p: NavigatorPage; i: number }[]>()
      rows.forEach((row) => {
        const sk = subGroupKey(row.p.code)
        if (sk === undefined) return
        if (!subRows.has(sk)) { subRows.set(sk, []); subOrder.push(sk) }
        subRows.get(sk)!.push(row)
      })
      const bundled = new Set(subOrder.filter((sk) => subRows.get(sk)!.length > 1))
      const seenSub = new Set<string>()
      type Entry = { kind: 'page'; p: NavigatorPage; i: number } | { kind: 'subgroup'; sub: { key: string; rows: { p: NavigatorPage; i: number }[] } }
      const entries: Entry[] = []
      rows.forEach((row) => {
        const sk = subGroupKey(row.p.code)
        if (sk !== undefined && bundled.has(sk)) {
          if (seenSub.has(sk)) return
          seenSub.add(sk)
          entries.push({ kind: 'subgroup', sub: { key: sk, rows: subRows.get(sk)! } })
        } else {
          entries.push({ kind: 'page', p: row.p, i: row.i })
        }
      })
      return { key, label, rows, entries }
    })
  }, [grouped, pages])

  // Live feedback follow-up — search bypasses the grouped/collapsible tree entirely and shows a
  // flat, ranked-by-document-order list of matches (page-level OR one of its leaves), same
  // pageRow renderer as everywhere else so a result behaves identically to a normal row. When the
  // match came from inside the leaf tree, that whole tree renders open (pageRow's `query ?
  // !!matchedLeaf : leavesOpen` and leafTree's `query ||` branches) so the matched node is
  // actually visible, not hidden behind a chevron the auditor would have to guess to tap.
  const needle = query.trim().toLowerCase()
  const searchResults = React.useMemo(() => {
    if (!needle) return []
    return pages
      .map((p, i) => ({ p, i, m: matchPage(p, needle) }))
      .filter(({ m }) => m.hit)
  }, [pages, needle])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border flex shrink-0 items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm"
      >
        <ListChecks size={15} />
        {doneCount}/{pages.length}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="themed-scrollbar flex max-h-[75vh] flex-col overflow-hidden rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-base">สารบัญรายการตรวจ</SheetTitle>
          </SheetHeader>
          <div className="border-border relative shrink-0 border-b px-4 pb-3">
            <Search size={14} className="text-muted-foreground pointer-events-none absolute left-7 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหารายการ…"
              className="border-border bg-secondary/40 w-full rounded-lg border py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="ล้างการค้นหา"
                className="text-muted-foreground absolute right-6 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-secondary"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
            {needle ? (
              searchResults.length > 0 ? (
                searchResults.map(({ p, i, m }) => pageRow(p, i, m.matchedLeaf))
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">ไม่พบรายการที่ค้นหา</p>
              )
            ) : grouped ? (
              sections.map((s) => {
                const sectionDone = s.rows.filter(({ p }) => p.total > 0 && p.answered === p.total).length
                const isOpen = openGroups.has(s.key)
                return (
                  <div key={s.key} className="mb-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(s.key)}
                      className="hover:bg-secondary/60 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors"
                    >
                      <span className="text-foreground text-sm font-semibold">{s.label ?? s.key}</span>
                      <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
                        {sectionDone}/{s.rows.length}
                        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="pl-1.5">
                        {s.entries.map((e) => e.kind === 'page' ? pageRow(e.p, e.i) : subGroupBlock(e.sub))}
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              pages.map((p, i) => pageRow(p, i))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
