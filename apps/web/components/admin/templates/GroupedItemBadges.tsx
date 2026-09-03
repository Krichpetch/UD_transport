// Session S4b, Part 3.4/3.5 — the three badges a canonical item can carry in the grouped editor.
// Kept as one small file since all three read directly off GroupNodeRow and are used together
// everywhere the item appears (group list, item detail, conflict queue) — a container node (round
// 2) carries these exactly the same way a leaf does.
//
// UDT-61, Part 1 — ClassificationBadge used to also restate the SHARED count ("ใช้ร่วมกัน N จุด"),
// duplicating the count already shown by InstanceBreakdownChips in the neighboring column. It now
// only flags the MODE_SPECIFIC case (the one piece of information this badge alone carries); a
// SHARED item renders no classification badge at all — its count lives solely in that other column.
import type { GroupNodeRow } from '@/lib/api/facility-groups'

export function ClassificationBadge({ item }: { item: GroupNodeRow }) {
  if (item.classification !== 'MODE_SPECIFIC') return null
  return (
    <span className="bg-secondary text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
      เฉพาะโหมดนี้
    </span>
  )
}

export function ConflictBadge({ item }: { item: GroupNodeRow }) {
  if (!item.hasConflict) return null
  return (
    <span
      title="ข้อมูล (ประเภทคำตอบ/เกณฑ์ตัวเลข) ไม่ตรงกันระหว่างแบบประเมิน — ต้องแก้ไขความขัดแย้งก่อนจึงจะเผยแพร่การแก้ไขพร้อมกันได้"
      className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600"
    >
      ข้อมูลไม่ตรงกัน{item.conflictAcknowledged ? ' (รับทราบแล้ว)' : ''}
    </span>
  )
}
