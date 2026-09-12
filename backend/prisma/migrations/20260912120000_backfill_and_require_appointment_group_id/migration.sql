CREATE EXTENSION IF NOT EXISTS "pgcrypto";

UPDATE "appointments"
SET "group_id" = gen_random_uuid()::text
WHERE "group_id" IS NULL;

ALTER TABLE "appointments" ALTER COLUMN "group_id" SET NOT NULL;