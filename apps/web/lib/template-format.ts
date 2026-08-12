// Session S4b-fix, Fix 1 — the grouped editor and the conflicts queue used to show a raw encoded
// signature like "presence_standard##gte|300||mm|||true&&gte|200||mm|||true" (the INTERNAL
// dedup key facility-grouping.core.ts#leafDataSignature builds for conflict detection — never
// meant for a screen). This module derives a human-readable description from the same structured
// data the signature is built from, for every place a screen needs to SHOW an answer spec rather
// than compare it. Also the single home for OPERATOR_LABEL, previously copy-pasted across
// MeasurementEditor.tsx / GroupedItemEditDialog.tsx / StructuralEditor.tsx.
import type { ThresholdOperator } from '@repo/types'

export const OPERATOR_LABEL: Record<ThresholdOperator, string> = {
  gte: 'ไม่น้อยกว่า (gte)',
  lte: 'ไม่เกิน (lte)',
  range: 'ช่วง (range)',
  tiered: 'ตารางขั้นบันได (tiered)',
}

export const OPERATOR_SYMBOL: Record<ThresholdOperator, string> = {
  gte: '≥',
  lte: '≤',
  range: '',
  tiered: '',
}

interface FormatMeasurementInput {
  operator: ThresholdOperator
  value?: number | null
  value2?: number | null
  unit: string
  tiers?: { min: number; max?: number | null; required: number }[] | null
}

// Session S5-fix, Part D — a threshold that never got extracted (both value slots null/missing)
// used to render as "≥- mm" / "-–- mm", which reads as a broken number rather than an honest "we
// don't have this one yet". Shown wherever a measurement never had a value extracted from source —
// never invented, never silently treated as 0.
export const NO_THRESHOLD_LABEL = 'ไม่มีเกณฑ์ที่ระบุ'

// One measurement -> "≥300 มม." / "≤300 มม." / "300–500 มม." / "ตารางขั้นบันได (3 ขั้น)" /
// "ไม่มีเกณฑ์ที่ระบุ" (value(s) never extracted).
export function formatMeasurementValue(m: FormatMeasurementInput): string {
  if (m.operator === 'tiered') {
    const n = m.tiers?.length ?? 0
    return `ตารางขั้นบันได (${n} ขั้น)`
  }
  if (m.operator === 'range') {
    if (m.value == null && m.value2 == null) return NO_THRESHOLD_LABEL
    return `${m.value ?? '-'}–${m.value2 ?? '-'} ${m.unit}`
  }
  if (m.value == null) return NO_THRESHOLD_LABEL
  return `${OPERATOR_SYMBOL[m.operator]}${m.value} ${m.unit}`
}

const ANSWER_TYPE_LABEL: Record<string, string> = {
  presence: 'มี/ไม่มี',
  presence_standard: 'มี/ไม่มี + ได้มาตรฐาน',
  choice: 'มี/ไม่มี/N/A',
}

// One line describing what an item asks and what it requires — the readable replacement for the
// raw signature string. Used on the grouped editor's list rows and the conflicts queue.
export function describeAnswerSpec(
  answerType: string | undefined,
  measurements: FormatMeasurementInput[],
): string {
  const base = answerType ? (ANSWER_TYPE_LABEL[answerType] ?? answerType) : 'ไม่มีคำตอบของตัวเอง (หมวดหมู่)'
  if (measurements.length === 0) return base
  return `${base} · เกณฑ์ ${measurements.map(formatMeasurementValue).join(', ')}`
}
