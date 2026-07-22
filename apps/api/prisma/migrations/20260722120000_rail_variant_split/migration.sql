-- E-form redesign (Session E3, Part A) — สนข. now issues separate checklists for metro (รถไฟฟ้า)
-- vs conventional rail (รถไฟ) stations. DECISION: the rail v2 DRAFT template seeded in Session
-- E1/E2 (mode='ทางราง', variantKey='standard', version=2) IS the รถไฟ (rail_train) checklist.
--
-- This re-keys that ONE existing row in place — same id, same createdAt, same definition — so
-- every existing Checklist row that already carries this template's id as its templateId stamp
-- (Checklist.templateId, a plain FK by id, never by (mode, variantKey, version)) is completely
-- unaffected. This is a data migration on the already-seeded row, NOT a reseed: re-running
-- seed-templates.ts would otherwise try to create a brand-new row at (ทางราง, standard, 2) since
-- its variant-file mapping now targets (ทางราง, rail_train, 2) instead — this migration is what
-- keeps the two in sync ahead of that.
--
-- The v1 ACTIVE anchor (mode='ทางราง', variantKey='standard', version=1) is deliberately left
-- untouched — v1 is not split by variant this session (see @repo/types#resolveVariantKey and
-- ChecklistsService.getActiveTemplate's fallback-to-standard behavior).
--
-- Idempotent: the WHERE clause only ever matches the pre-migration row, so re-running this file
-- (or applying it to a DB where it already ran) is a no-op the second time.
UPDATE "ChecklistTemplate"
SET "variantKey" = 'rail_train'
WHERE "mode" = 'ทางราง' AND "variantKey" = 'standard' AND "version" = 2;
