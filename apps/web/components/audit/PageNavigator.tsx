'use client'

import * as React from 'react'
import { Check, ListChecks } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export interface NavigatorPage {
  code?: string
  label: string
  sublabel?: string
  answered: number
  total: number
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
            {pages.map((p, i) => {
              const done = p.total > 0 && p.answered === p.total
              const started = p.answered > 0 && !done
              return (
                <button
                  key={i}
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
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
