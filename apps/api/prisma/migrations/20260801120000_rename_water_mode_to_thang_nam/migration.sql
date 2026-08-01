-- Session F2, Part B — canonical TransportMode value for water/waterway transport changes
-- from "ทางเรือ" to "ทางน้ำ" (matching สนข.'s own source-workbook term — see the removed
-- normalize_mode() in tools/station-masterlist/convert_masterlist.py and the removed fixup
-- in prisma/seed-templates.ts, both of which used to convert the workbook's "ทางน้ำ" INTO
-- "ทางเรือ" on the way in; that direction is now reversed project-wide, matching
-- @repo/types#TRANSPORT_MODES).
--
-- Three places store the mode string and all three need updating:
--   1. Station.mode (the column)
--   2. ChecklistTemplate.mode (the column)
--   3. ChecklistTemplate.definition (the JSON blob also embeds `mode` at its top level —
--      see @repo/types#ChecklistTemplateDefinition)
--
-- AuditLog.before/after JSON snapshots are deliberately NOT rewritten here — they are a
-- historical record of what a row looked like at the time of a past mutation, not live data.

UPDATE "Station"
SET "mode" = 'ทางน้ำ'
WHERE "mode" = 'ทางเรือ';

UPDATE "ChecklistTemplate"
SET "mode" = 'ทางน้ำ'
WHERE "mode" = 'ทางเรือ';

UPDATE "ChecklistTemplate"
SET "definition" = jsonb_set("definition", '{mode}', '"ทางน้ำ"')
WHERE "definition" ->> 'mode' = 'ทางเรือ';
