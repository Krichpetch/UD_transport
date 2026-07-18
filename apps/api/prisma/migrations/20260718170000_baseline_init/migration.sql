-- Baseline migration — captures the schema as it existed under `prisma db push` immediately
-- before the Session E1 e-form redesign. This project is converting from db push to prisma
-- migrate; this migration exists so migration history has a starting point.
--
-- DO NOT run this against the existing shared dev database via `prisma migrate deploy` — it
-- already has this exact schema from db push and this file would fail on the CREATE TABLE
-- statements (relations already exist). Instead, mark it as already applied:
--   npx prisma migrate resolve --applied 20260718170000_baseline_init
-- Then apply the following migrations normally with `prisma migrate deploy` (or `dev`).
--
-- A genuinely fresh database (no prior db push) should run this migration normally along with
-- everything after it — see the E1 final report for how this was verified against both cases.
--
-- NOTE: the PostGIS generated geography column + GiST index used by
-- StationsService.findNearby/distanceToStationMeters are intentionally NOT part of this migration
-- — they remain managed by prisma/migrations_manual/2026-07-03_station-geography-column.sql +
-- apply-manual-migrations.cjs, unchanged by this session.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AUDITOR', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CoordSource" AS ENUM ('OFFICIAL', 'GEOCODED', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "CoordStatus" AS ENUM ('OK', 'APPROXIMATE', 'PENDING', 'INVALID');

-- CreateEnum
CREATE TYPE "StationScope" AS ENUM ('IN_SCOPE', 'OUT_OF_SCOPE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AUDITOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "railSubtype" TEXT,
    "province" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "responsibleAgency" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "coordSource" "CoordSource" NOT NULL DEFAULT 'NONE',
    "coordStatus" "CoordStatus" NOT NULL DEFAULT 'PENDING',
    "scope" "StationScope" NOT NULL DEFAULT 'IN_SCOPE',
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "sourceFile" TEXT,
    "sourceId" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ต้องปรับปรุง',
    "lastInspected" TIMESTAMP(3),
    "urgentIssues" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "gpsDistanceM" DOUBLE PRECISION,
    "locationVerified" BOOLEAN,
    "proximityBypassed" BOOLEAN,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Station_nameTh_mode_responsibleAgency_province_key" ON "Station"("nameTh", "mode", "responsibleAgency", "province");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
