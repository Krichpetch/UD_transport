-- Phase 1: PostGIS geography column for proximity queries (GET /stations/nearby, submit-time
-- distance gate). Additive only — does not touch lat/lng or any existing data.
-- Applied by hand (this project uses `prisma db push`, not `prisma migrate`, for schema sync).
-- Requires: CREATE EXTENSION postgis; (already run once when the DB container was switched
-- from postgres:16 to postgis/postgis:16-3.4).
--
-- Deliberately NOT declared in schema.prisma: Prisma's `Unsupported()` type still tries to
-- diff/alter generated columns during `db push` and fails ("column is a generated column").
-- Queried only via $queryRaw in stations.service.ts (ST_DWithin/ST_Distance). `db push` never
-- touches columns it doesn't know about, so leaving it undeclared is the safe, standard
-- workaround — re-run this file by hand if the DB is ever rebuilt from scratch.

ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS geog geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS station_geog_idx ON "Station" USING GIST (geog);
