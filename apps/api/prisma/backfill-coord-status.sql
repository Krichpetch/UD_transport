-- Backfill coordSource / coordStatus for existing stations.
-- Run this ONCE after `prisma db push` adds the new columns.
--
-- All stations currently in the DB were populated by the OTP import, which falls back
-- to province centroids when no real per-station coordinate is available.
-- We have no way to tell OFFICIAL from GEOCODED at this point, so mark everything
-- GEOCODED / APPROXIMATE, which is the conservative / honest choice.
-- When a re-import runs with real lat/lng from the source files those rows will be
-- updated to OFFICIAL / OK by the import service.

UPDATE "Station"
SET
  "coordSource" = 'GEOCODED'::"CoordSource",
  "coordStatus" = 'APPROXIMATE'::"CoordStatus"
WHERE
  lat IS NOT NULL
  AND lng IS NOT NULL
  AND "coordStatus" = 'PENDING'::"CoordStatus";

-- Stations that were left with 0,0 (shouldn't happen, but guard anyway)
UPDATE "Station"
SET
  "coordSource" = 'NONE'::"CoordSource",
  "coordStatus" = 'INVALID'::"CoordStatus"
WHERE
  (lat = 0 AND lng = 0)
  AND "coordStatus" = 'PENDING'::"CoordStatus";
