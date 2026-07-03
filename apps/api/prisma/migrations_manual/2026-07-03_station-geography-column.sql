-- Phase 1: PostGIS proximity queries (GET /stations/nearby, submit-time distance gate).
-- Additive only — does not touch lat/lng or any existing data.
-- Applied by hand (this project uses `prisma db push`, not `prisma migrate`, for schema sync).
-- Run via: pnpm --filter api db:manual-migrations (see prisma/apply-manual-migrations.cjs).
--
-- Requires a Postgres build with PostGIS available (e.g. the postgis/postgis Docker image).
-- CREATE EXTENSION will fail loudly on a stock postgres image — that's intentional; it means
-- the environment needs to be switched to a PostGIS-capable Postgres before this can run.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Deliberately an EXPRESSION index, not a stored generated column: Prisma's `Unsupported()`
-- type still tries to diff/alter generated columns during `db push` and fails ("column is a
-- generated column"), and a plain undeclared column gets flagged for DROP by `db push` on the
-- next run (it reconciles the DB to exactly match schema.prisma). An index on an expression is
-- invisible to Prisma either way — nothing for `db push` to fight over — while the query
-- planner still uses it for ST_DWithin/ST_Distance in stations.service.ts (verified via EXPLAIN).
--
-- (An earlier draft of this file used a `geog geography(Point,4326) GENERATED ALWAYS AS (...)
-- STORED` column + an index on that column — superseded by this expression-index approach for
-- the reason above. If you find that shape anywhere, it's stale.)
CREATE INDEX IF NOT EXISTS station_geog_idx ON "Station"
  USING GIST ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography));
