-- E-form redesign (Session E2, Part A) — Station.yearBuilt (auditor-entered Buddhist year) and
-- the Checklist era-resolution stamp (appliedYearBuilt/appliedLawRefs), alongside the existing
-- templateId/templateVersion stamp from Session E1. See @repo/types#resolveTemplateEras and
-- ChecklistsService for how these are populated — structure only here, no data migration needed
-- (both are nullable; every pre-existing row simply has them unset).

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "yearBuilt" INTEGER;

-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN "appliedYearBuilt" INTEGER,
ADD COLUMN     "appliedLawRefs" JSONB;
