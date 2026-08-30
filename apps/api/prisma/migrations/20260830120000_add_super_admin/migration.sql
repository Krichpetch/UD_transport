-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- UDT-53: grandfather existing admins. They had full power over user management before this
-- change, so preserve it (no privilege loss on upgrade) and guarantee at least one sys admin
-- exists (no lockout). The new "regular admin" restriction applies only to ADMIN accounts
-- created AFTER this migration, which default to isSuperAdmin = false.
UPDATE "User" SET "isSuperAdmin" = true WHERE "role" = 'ADMIN';
