'use client'

import * as React from 'react'
import { Info, X } from 'lucide-react'
import type { TemplateNode, TemplateMeasurement } from '@repo/types'

// E-form redesign (Session E2, Part C.8) — "คู่มือการตรวจประเมิน" info affordance. Read-only for
// auditors: shows the (already era-resolved) threshold values, sourceText, and guidance text for
// one leaf/criterion. Never editable here — admin threshold editing is out of scope (Workstream 2).
function unitLabel(m: { unit: string }): string {
  if (m.unit === 'ratio_1_x') return 'อัตราส่วน 1 : X'
  return m.unit
}

function measurementSummary(m: TemplateMeasurement): string {
  if (m.operator === 'tiered') {
    return `ตารางขั้นบันได (${m.inputs?.map((i) => i.labelTh).join(' / ') ?? ''})`
  }
  if (m.operator === 'range') return `${m.value ?? '-'} – ${m.value2 ?? '-'} ${unitLabel(m)}`
  if (m.operator === 'gte') return `ไม่น้อยกว่า ${m.value ?? '-'} ${unitLabel(m)}`
  return `ไม่เกิน ${m.value ?? '-'} ${unitLabel(m)}`
}

// `breadcrumb` (Session E2 follow-up) — the ancestor chain's labels (group → item → … → this
// node), so the popup is never ambiguous about which criterion it belongs to, even once several
// modals have been opened across a long form. Always includes the node's own `code` as a visible
// chip regardless of whether a breadcrumb was supplied.
export function ThresholdModalTrigger({ node, breadcrumb }: { node: TemplateNode; breadcrumb?: string[] }) {
  const [open, setOpen] = React.useState(false)
  const hasContent = !!node.guidance || (node.measurements && node.measurements.length > 0)
  if (!hasContent) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-primary shrink-0"
        aria-label="คู่มือการตรวจประเมิน"
      >
        <Info size={13} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">คู่มือการตรวจประเมิน</p>
              <button onClick={() => setOpen(false)} className="text-muted-foreground shrink-0">
                <X size={16} />
              </button>
            </div>
            {breadcrumb && breadcrumb.length > 0 && (
              <p className="text-[10px] text-muted-foreground">{breadcrumb.join(' › ')}</p>
            )}
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{node.code}</span>
              <p className="text-xs font-medium text-gray-700">{node.labelTh}</p>
            </div>

            {node.measurements && node.measurements.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {node.measurements.map((m) => (
                  <div key={m.key} className="rounded-lg bg-secondary/60 p-2.5 text-xs">
                    <p className="font-semibold text-gray-800">{measurementSummary(m)}</p>
                    {m.sourceText && <p className="mt-1 text-gray-500">{m.sourceText}</p>}
                  </div>
                ))}
              </div>
            )}

            {node.guidance && (
              <div className="mt-3 border-t border-border pt-3 text-xs text-gray-600">
                <p>{node.guidance.text}</p>
                {node.guidance.reference && (
                  <p className="mt-1 text-[10px] text-muted-foreground">อ้างอิง: {node.guidance.reference}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
