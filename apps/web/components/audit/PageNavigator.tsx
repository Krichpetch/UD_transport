'use client'

import * as React from 'react'
import { Check, ChevronDown, ListChecks } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

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
  const doneCount = pages.filter((p) => p.total > 0 && p.answered === p.total).length
  const grouped = pages.some((p) => p.groupKey !== undefined)

  // Session S4a, Part D.2 — which group sections are expanded. Re-synced to "just the group
  // containing currentPage" every time the sheet opens, so a long metro form always opens with
  // the auditor's current position visible, not every section collapsed or all of them expanded.
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    if (!open || !grouped) return
    const current = pages[currentPage]?.groupKey
    setOpenGroups(current !== undefined ? new Set([current]) : new Set())
  }, [open, grouped, pages, currentPage])

  function toggleGroup(key: string) {
    setOpenGroups((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Lowercase + called-as-a-function (not rendered as a JSX tag) so eslint's component-detection
  // heuristic (react/prop-types) doesn't treat this as a component needing its own prop types —
  // it's just a shared render helper for the two branches below, same as the rest of this file's
  // inline `pages.map((p, i) => …)` callbacks never needed one either.
  function pageRow(p: NavigatorPage, i: number) {
    const done = p.total > 0 && p.answered === p.total
    const started = p.answered > 0 && !done
    return (
      <button
        type="button"
        onClick={() => {
          onJump(i)
          setOpen(false)
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
          i === currentPage ? 'bg-primary/10' : 'hover:bg-secondary/60'
        }`}
      >
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm">
            {p.code && (
              <span className="bg-secondary text-muted-foreground mr-1.5 rounded px-1.5 py-0.5 font-mono text-[11px]">{p.code}</span>
            )}
            {p.label}
          </p>
          {p.sublabel && <p className="text-muted-foreground truncate text-xs">{p.sublabel}</p>}
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${
            done ? 'text-green-600' : started ? 'text-amber-600' : 'text-muted-foreground'
          }`}
        >
          {done ? <Check size={16} /> : `${p.answered}/${p.total}`}
        </span>
      </button>
    )
  }

  // Groups in first-seen order (matches the pager's own A1→A2→...→B1→... document order).
  const sections = React.useMemo(() => {
    if (!grouped) return []
    const order: string[] = []
    const byKey = new Map<string, { label?: string; rows: { p: NavigatorPage; i: number }[] }>()
    pages.forEach((p, i) => {
      const key = p.groupKey ?? ''
      if (!byKey.has(key)) { byKey.set(key, { label: p.groupLabel, rows: [] }); order.push(key) }
      byKey.get(key)!.rows.push({ p, i })
    })
    return order.map((key) => ({ key, ...byKey.get(key)! }))
  }, [grouped, pages])

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
          <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {grouped
              ? sections.map((s) => {
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
                          {s.rows.map(({ p, i }) => <React.Fragment key={i}>{pageRow(p, i)}</React.Fragment>)}
                        </div>
                      )}
                    </div>
                  )
                })
              : pages.map((p, i) => <React.Fragment key={i}>{pageRow(p, i)}</React.Fragment>)}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
