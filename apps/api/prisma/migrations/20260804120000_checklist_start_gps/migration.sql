-- Session F3, Part H — proximity gate moved from SUBMIT to START.
--
-- สนข. meeting 2026-08-03 (Dr.Aliz): "อยากให้การส่งงานเป็นแบบที่ กดเข้าไปทำได้แค่ตอนอยู่ใกล้สถานี
-- แต่ถ้าเริ่มทำไปแล้วจะอยู่ใน Draft แล้วสามารถส่งจากที่ไหนก็ได้."
--
-- The pre-existing gps*/locationVerified/proximityBypassed columns record the SUBMIT-time reading
-- and keep their exact original meaning. They no longer prove the auditor was at the station,
-- because submitting from anywhere is now allowed by design — these new columns carry that proof
-- instead, recorded at the moment the checklist row was created.
--
-- Deliberately NEW columns, not a repurposing of the existing ones: a pre-F3 row's submit-time
-- reading WAS gated and a post-F3 row's was not, and overloading one set of columns would make
-- those two cases indistinguishable after the fact. startLocationVerified IS NULL therefore means
-- exactly "created before this migration" for historical rows.
--
-- Purely additive: six nullable columns, no defaults, no backfill, no rewrites. Every existing
-- row keeps NULL, which is the correct reading of "no start-time GPS was ever captured for this
-- checklist". Safe to apply to current data and on a fresh database alike.

ALTER TABLE "Checklist" ADD COLUMN "startGpsLat" DOUBLE PRECISION;
ALTER TABLE "Checklist" ADD COLUMN "startGpsLng" DOUBLE PRECISION;
ALTER TABLE "Checklist" ADD COLUMN "startGpsAccuracy" DOUBLE PRECISION;
ALTER TABLE "Checklist" ADD COLUMN "startGpsDistanceM" DOUBLE PRECISION;
ALTER TABLE "Checklist" ADD COLUMN "startLocationVerified" BOOLEAN;
ALTER TABLE "Checklist" ADD COLUMN "startProximityBypassed" BOOLEAN;
