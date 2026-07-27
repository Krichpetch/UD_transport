/*
  Warnings:

  - A unique constraint covering the columns `[mode,nameTh,line]` on the table `Station` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CoordSource" ADD VALUE 'NATIVE';
ALTER TYPE "CoordSource" ADD VALUE 'FILE2';
ALTER TYPE "CoordSource" ADD VALUE 'FILE2_UTM';

-- AlterEnum
ALTER TYPE "CoordStatus" ADD VALUE 'PENDING_COORDS';

-- DropIndex
DROP INDEX "Station_nameTh_mode_responsibleAgency_province_key";

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "coordMatchStatus" TEXT,
ADD COLUMN     "line" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "matchedNameFile2" TEXT,
ADD COLUMN     "stationType" TEXT,
ALTER COLUMN "province" DROP NOT NULL,
ALTER COLUMN "region" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Station_mode_nameTh_line_key" ON "Station"("mode", "nameTh", "line");
