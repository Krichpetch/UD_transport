'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// UDT-55 — a small confirm-guard dialog for one-and-done mutating actions (approve, revert an
// approval). Mirrors the auditor UnsubmitButton's Dialog pattern (audit/my-work/[id]) — the repo
// has no shadcn AlertDialog primitive, Dialog is the established confirm convention.
interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  pending?: boolean
  error?: string | null
  /** Red confirm button (for reverting/undoing) vs. the default primary navy. */
  destructive?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  onConfirm,
  pending = false,
  error,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-5">
        <DialogTitle className="text-sm font-bold text-foreground">{title}</DialogTitle>
        {body && <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</div>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="flex-1 rounded-lg border border-border py-2.5 text-xs font-medium text-foreground disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold text-white disabled:opacity-60 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-primary'
            }`}
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
