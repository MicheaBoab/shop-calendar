-- ONE-TIME irreversible business reset. Backup waived for this reset only.
-- Stop ALL backends/writers before deploy; locks cannot stop old instances.
-- PostgreSQL Prisma migrations are not implicitly transactional.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Match allocator order: global advisory lock BEFORE any user/table writes.
SELECT pg_advisory_xact_lock(714021, 0);
-- Fail immediately if a writer is still using these tables. Reads remain allowed.
-- User -> appointment -> audit order matches creation/audit transactions.
LOCK TABLE "users", "appointments", "audit_logs", "staff_color_map",
  "manager_color_map", "user_roles" IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE "shops", "system_settings", "roles", "permissions",
  "role_permissions" IN SHARE MODE NOWAIT;

DO $$
BEGIN
  IF (EXISTS (SELECT 1 FROM "users")
      OR EXISTS (SELECT 1 FROM "appointments")
      OR EXISTS (SELECT 1 FROM "audit_logs")
      OR EXISTS (SELECT 1 FROM "staff_color_map")
      OR EXISTS (SELECT 1 FROM "manager_color_map"))
     AND NOT EXISTS (
       SELECT 1 FROM "users"
       WHERE "role" = 'admin' AND "status" = 'active' AND "deleted_at" IS NULL
     ) THEN
    RAISE EXCEPTION 'Business reset requires an active undeleted ADMIN on a nonempty database';
  END IF;
END $$;

-- Exact seed-generated username AND own shop, not the broad runtime prefix test.
-- Empty fresh installs have no users yet; the existing seed runs AFTER migrations.
CREATE TEMP TABLE "_business_reset_targets" ON COMMIT DROP AS
SELECT "id" FROM "users"
WHERE "role" <> 'admin'
  AND "username" <> ('pending_assignment__' || "shop_id");

-- Full records include hashes: temporary only, never printed or stored permanently.
CREATE TEMP TABLE "_business_reset_preserved_users" ON COMMIT DROP AS
SELECT * FROM "users"
WHERE "id" NOT IN (SELECT "id" FROM "_business_reset_targets");

DELETE FROM "audit_logs";
DELETE FROM "appointments";
DELETE FROM "staff_color_map";
DELETE FROM "manager_color_map";
DELETE FROM "user_roles"
WHERE "user_id" IN (SELECT "id" FROM "_business_reset_targets");
DELETE FROM "users"
WHERE "id" IN (SELECT "id" FROM "_business_reset_targets");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "audit_logs")
     OR EXISTS (SELECT 1 FROM "appointments")
     OR EXISTS (SELECT 1 FROM "staff_color_map")
     OR EXISTS (SELECT 1 FROM "manager_color_map")
     OR EXISTS (
       SELECT 1 FROM "users"
       WHERE "role" <> 'admin'
         AND "username" <> ('pending_assignment__' || "shop_id")
     )
     OR EXISTS (
       SELECT 1 FROM "user_roles"
       WHERE "user_id" IN (SELECT "id" FROM "_business_reset_targets")
     ) THEN
    RAISE EXCEPTION 'Business reset postcondition failed: deletion targets remain';
  END IF;
  IF EXISTS (
    (SELECT * FROM "users" EXCEPT ALL
     SELECT * FROM "_business_reset_preserved_users")
    UNION ALL
    (SELECT * FROM "_business_reset_preserved_users" EXCEPT ALL
     SELECT * FROM "users")
  ) THEN
    RAISE EXCEPTION 'Business reset postcondition failed: preserved users changed';
  END IF;
END $$;
COMMIT;
