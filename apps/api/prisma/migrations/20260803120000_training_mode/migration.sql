-- Session S3b, Part A — tutorial/example mode.
-- Purely additive: two nullable-default-false booleans. Safe on current data (every existing row
-- gets isTraining=false, matching every historical Station/Checklist row being real data).

ALTER TABLE "Station" ADD COLUMN "isTraining" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Checklist" ADD COLUMN "isTraining" BOOLEAN NOT NULL DEFAULT false;
