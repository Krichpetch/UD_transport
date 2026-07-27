-- Part G.2 (W2-S1) — nullable responsible-agency field on User. Additive/nullable: safe on
-- existing data, no backfill needed (existing users simply have agency = NULL until an admin
-- sets it via the users admin form).
ALTER TABLE "User" ADD COLUMN "agency" TEXT;
