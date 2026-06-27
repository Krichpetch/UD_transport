# UD Transport — Claude Code Instructions

## Government project — read first

**Client:** สนข. (Office of Transport and Traffic Policy and Planning), Ministry of Transport, Thailand
**Classification:** Official government inspection data — treat as confidential.

Security rules that apply to every change:
- No real inspection data or PII should appear in test fixtures, seed files, or logs
- No `.env`, `.env.*`, or credential files should ever be committed to git
- All API endpoints must be role-guarded (ADMIN / AUDITOR / EXECUTIVE)
- Every data mutation (checklist submit, station update) must write an AuditLog entry
- Secrets (JWT_SECRET, DATABASE_URL) must be long random strings in production — never the dev placeholders from `.env.example`
- Any bcrypt password hashing must use BCRYPT_ROUNDS (=12) from src/config/constants.ts. Never use the library default. Current code: seed.ts uses 12; bcrypt.compare in auth.service needs no rounds.

---

## Project structure
Turborepo monorepo. Main app is in `apps/web` (Next.js 16, TypeScript, Tailwind v4, shadcn/ui).
Backend will live in `apps/api` (NestJS, Prisma, PostgreSQL) — not yet built.

## Dev commands
- `cd apps/web && pnpm dev` — start frontend on localhost:3000
- `cd apps/web && pnpm build` — build and type-check
- `pnpm lint` — lint all packages

## Stack rules
- Always use TypeScript. No `any` types.
- Tailwind v4 only — CSS variables defined in `globals.css`. No tailwind.config file.
- Use shadcn/ui components from `@/components/ui/` — never install MUI or other UI libs.
- All mock data and types live in `apps/web/lib/mock-data.ts`. Read it before touching any data shape.
- Leaflet maps must use `next/dynamic` with `ssr: false` — Leaflet accesses window at import time.
- Client components that use hooks or browser APIs must have `'use client'` at the top.

## Route layout
- `app/(auth)/` — login page, no sidebar
- `app/(dashboard-layout)/` — admin/executive pages, shared sidebar + navbar layout
- `app/(audit-layout)/` — auditor mobile views, max-w-sm gradient shell, no sidebar

## Role-based routing (login page)
- EXECUTIVE → /dashboard
- ADMIN → /dashboard
- AUDITOR → /audit

---

## Data model — read carefully before any checklist or scoring work

### Transport taxonomy
```ts
type TransportMode = 'ทางบก' | 'ทางราง' | 'ทางเรือ' | 'ทางอากาศ'
type RailSubtype   = 'รถไฟฟ้า' | 'รถไฟ'  // only when mode === 'ทางราง'
```
The 5 station types for filtering are:
สถานีขนส่งผู้โดยสาร (ทางบก), สถานีรถไฟ (ทางราง/รถไฟ),
สถานีรถไฟฟ้า (ทางราง/รถไฟฟ้า), ท่าเรือโดยสาร (ทางเรือ), ท่าอากาศยาน (ทางอากาศ)

### ChecklistValue — 4 states, not 3
```ts
type ChecklistValue = 'มี' | 'ไม่มี' | 'N/A' | null
```
- `meetsStandard: boolean` is a SEPARATE field — only meaningful when value === 'มี'
- `meetsStandard` must reset to false when value changes away from 'มี'
- N/A items must be EXCLUDED from all score calculations (denominator and numerator)
- The 4 display states are: "มี และได้มาตรฐาน" / "มี แต่ไม่ได้มาตรฐาน" / "ไม่มี" / "ไม่เกี่ยวข้อง (N/A)"

### ChecklistSubItem fields
```ts
interface ChecklistSubItem {
  id: string            // e.g. 'A1.1'
  labelTh: string
  value: ChecklistValue
  meetsStandard: boolean
  cabinetPriority: boolean  // true = mandated by มติ ครม.
  note: string
  photos: ChecklistPhoto[]
  flagged: boolean
}
```
Items with cabinetPriority = true:
ที่จอดรถคนพิการ, ทางลาด, ห้องน้ำคนพิการ, ป้ายสัญลักษณ์, ข้อมูลข่าวสาร/การบริการข้อมูล

### Station fields (includes required agency)
```ts
interface Station {
  id, name, nameTh: string
  mode: TransportMode
  railSubtype?: RailSubtype
  province: string
  region: string
  responsibleAgency: string  // e.g. 'ขบ.' | 'รฟท.' | 'รฟม.' | 'ทอท.' etc.
  score: number
  status: StationStatus
  lastInspected: string | null
  lat: number
  lng: number
  urgentIssues: string[]
}
```

Valid responsible agencies: ขบ., ขสมก., บขส., รฟท., รฟม., รฟฟท., BEM, จท., ทย., ทอท., อื่นๆ

---

## Scoring formulas — use these exactly, do not invent alternatives

Given a filtered set of stations and a checklist item category:

| Metric | Formula |
|---|---|
| จำนวนสถานีทั้งหมด | count of stations matching filter |
| จำนวนสถานีที่มีรายการดังกล่าว | stations where value === 'มี' (either standard) |
| จำนวนสถานีที่ได้มาตรฐาน | stations where value === 'มี' && meetsStandard === true |
| ร้อยละความสำเร็จ | (ได้มาตรฐาน ÷ ทั้งหมด) × 100 |
| ร้อยละการจัดให้มีสิ่งอำนวยความสะดวก | (มีรายการนั้น ÷ ทั้งหมด) × 100 |
| ร้อยละการได้มาตรฐาน | (ได้มาตรฐาน ÷ มีรายการนั้น) × 100 |

All 6 metrics must be shown together whenever a score is displayed.
N/A items are excluded from both numerator and denominator.

---

## Filter dimensions — all dashboards must support these

1. ประเภทการขนส่ง (Transport Mode) — the 5 station types listed above
2. พื้นที่ (Geographic Area) — รายจังหวัด / รายภาค / ระดับประเทศ
3. หน่วยงานรับผิดชอบ (Responsible Agency) — the 10 agencies listed above
4. หมวดรายการตรวจสอบ (Checklist Category) — A (Accessibility) / B (Operation) / C (Staff)
   or specific sub-item (e.g. ที่จอดรถคนพิการ, ทางลาด, ลิฟต์)

---

## Drill-down hierarchy

Dashboard must support clicking from coarse to fine:
ระดับประเทศ → ภาค → จังหวัด → หน่วยงาน → สถานี → รายการตรวจสอบ → ผลการตรวจ

---

## Checklist page (admin view — read-only)
`app/(dashboard-layout)/stations/[id]/page.tsx` is ADMIN-ONLY and READ-ONLY.
Auditors submit via the mobile audit view at `/audit`.
Column order: รหัส | รายการ | มี | ไม่มี | ได้มาตรฐาน | หลักฐาน | พลิกฉาก
- ได้มาตรฐาน checkbox is only active when มี is selected
- หลักฐาน shows auditor-uploaded photo thumbnails (read-only, click to lightbox)
- พลิกฉาก shows orange badge if flagged, — if not
- No upload buttons, no edit controls on this page

---

## Git
- Work on feature branches. Commit before large changes.
- Never commit .env or .env.* files.