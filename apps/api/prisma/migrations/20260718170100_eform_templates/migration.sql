-- E-form redesign (Session E1, Parts A / A2 / A.4) — ChecklistTemplate + LawReference models,
-- and the templateId/templateVersion/finalThoughts columns on Checklist.
--
-- This migration only creates structure. Data (the 4 v1 ACTIVE templates, the 4 v2 DRAFT
-- templates, the 5 LawReference rows, and the backfill of templateId/templateVersion onto every
-- pre-existing Checklist row) is populated by `ts-node prisma/seed-templates.ts`, run once after
-- this migration — see that script's header comment and the E1 final report for why this is a
-- script rather than raw SQL (facility-catalog name-matching and template-JSON validation both
-- need @repo/types' TypeScript logic, not something worth re-implementing in SQL).

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN     "finalThoughts" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT 'standard',
    "version" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LawReference" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "ministry" TEXT NOT NULL,
    "buddhistYear" INTEGER NOT NULL,
    "effectiveYear" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LawReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_mode_variantKey_version_key" ON "ChecklistTemplate"("mode", "variantKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LawReference_code_key" ON "LawReference"("code");

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
