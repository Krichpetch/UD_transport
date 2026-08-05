-- 2026-08-05 — exact-date refinement for era resolution.
--
-- Station.yearBuilt (a Buddhist YEAR) can't distinguish two laws whose enforcement dates fall in
-- the same Buddhist year but different Gregorian dates — concretely, PSD_2555 (effective 16 ม.ค.
-- 2556) and MOT_2556 (effective 3 เม.ย. 2556) both land in พ.ศ. 2556. A station permitted in early
-- 2556 reads as already under both laws, when it may only actually be under the first. These
-- three columns let an auditor's exact building-permit-application date (when they can find one,
-- e.g. on a permit placard) refine that comparison — see @repo/types#isLawInForce.
--
-- Purely additive: three nullable DATE columns, no defaults, no backfill, no rewrites. Every
-- existing row keeps NULL, which is the correct reading of "no exact date was ever captured" —
-- resolution silently falls back to the pre-existing year-only comparison, byte-for-byte.

ALTER TABLE "Station" ADD COLUMN "yearBuiltDate" DATE;
ALTER TABLE "Checklist" ADD COLUMN "appliedYearBuiltDate" DATE;
ALTER TABLE "LawReference" ADD COLUMN "effectiveDate" DATE;
