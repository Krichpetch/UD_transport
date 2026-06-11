# apps/web — Frontend context

See @package.json for all available scripts.
See @lib/mock-data.ts for all types, interfaces, and mock station/checklist data.

## Key imports
- Types: `TransportMode`, `RailSubtype`, `ChecklistValue`, `ChecklistSubItem`, `ChecklistGroup`, `Station`
- Helpers: `getChecklistTemplate(mode)` — deep-clones a fresh checklist for a station
- Templates: `checklistTemplates` — keyed by TransportMode, from OTP data dictionary (17 เม.ย. 2566)

## Score calculation reminder
When computing scores, always:
1. Exclude items where value === 'N/A' from both numerator AND denominator
2. Use `meetsStandard` as a separate boolean — never treat 'ได้มาตรฐาน' as a ChecklistValue
3. Show all 6 metrics together (see root CLAUDE.md for formulas)

## Component conventions
- Checklist rows: มี / ไม่มี are radio-style toggles; ได้มาตรฐาน is a checkbox gated on มี being selected
- Status badges: ผ่านมาตรฐาน (green #52aa4e) / ต้องปรับปรุง (yellow #ffc107) / ไม่ผ่าน (red #f44336)
- Transport mode badges: use distinct colours per mode so they're scannable at a glance
- cabinetPriority items should be visually distinguished (e.g. small มติ ครม. tag) when filtering by sub-item

## What NOT to do
- Do not add upload or edit controls to `stations/[id]/page.tsx` — admin page is read-only
- Do not use localStorage (breaks in Claude.ai artifacts)
- Do not install new UI libraries without checking with the developer first