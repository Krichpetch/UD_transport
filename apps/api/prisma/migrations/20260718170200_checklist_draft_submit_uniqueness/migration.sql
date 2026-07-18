-- E-form redesign (Session E1, Part D) — replaces the two Session-2 read-then-write stopgap
-- markers that used to live in checklists.service.ts with real DB-enforced uniqueness.
--
-- Both are PARTIAL unique indexes (scoped by a WHERE clause to one literal status value), which
-- Prisma's schema.prisma DSL cannot express as of Prisma 6 (no partial-index syntax) — same
-- category of "PG feature the schema DSL can't represent" as the existing PostGIS geography
-- column in migrations_manual/. Unlike that column, these two indexes ARE plain Postgres DDL
-- with no Prisma-incompatible column type, so they live in the normal migration history (this
-- file) rather than migrations_manual/ — only the *expression* (the WHERE clause) needed hand
-- authoring, nothing about how it's applied.
--
-- 1) One DRAFT per (stationId, auditorId). saveDraft() becomes a true upsert against this index;
--    a concurrent double-create resolves via the P2002 unique-violation handler in
--    checklists.service.ts (one write wins, the other's caller retries as an update).
CREATE UNIQUE INDEX "checklist_one_draft_per_station_auditor"
  ON "Checklist" ("stationId", "auditorId")
  WHERE "status" = 'DRAFT';

-- 2) At most one SUBMITTED (= pending review — not yet APPROVED/REJECTED, both terminal)
--    checklist per (stationId, auditorId). Replaces the old SUBMIT_DEDUPE_WINDOW_MS read-then-
--    write guard, which only closed a 10-minute window rather than being a real constraint.
CREATE UNIQUE INDEX "checklist_one_pending_submit_per_station_auditor"
  ON "Checklist" ("stationId", "auditorId")
  WHERE "status" = 'SUBMITTED';
