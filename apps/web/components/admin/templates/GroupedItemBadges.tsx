// Session S4b, Part 3.4/3.5 — the three badges a canonical item can carry in the grouped editor.
// Kept as one small file since all three read directly off GroupNodeRow and are used together
// everywhere the item appears (group list, item detail, conflict queue) — a container node (round
// 2) carries these exactly the same way a leaf does.
import type { GroupNodeRow } from '@/lib/api/facility-groups'

export function ClassificationBadge({ item }: { item: GroupNodeRow }) {
  if (item.classification === 'MODE_SPECIFIC') {
    return (
      <span className="bg-secondary text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
        เฉพาะโหมดนี้
      </span>
    )
  }
  return (
    <span className="bg-accent/10 text-accent inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
      ใช้ร่วมกัน {item.instanceCount} จุด
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
