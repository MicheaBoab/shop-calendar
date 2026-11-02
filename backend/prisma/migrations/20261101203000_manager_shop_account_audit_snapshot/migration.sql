-- Replace the former multi-shop employee role with a service-capable manager role.
ALTER TYPE "UserRole" RENAME VALUE 'multi_shop_employee' TO 'manager';
ALTER TYPE "UserRole" ADD VALUE 'shop_account';

-- Existing RBAC tables are currently unused. Preserve their assignments if a MANAGER
-- row was created independently before this migration.
DO $$
DECLARE
  old_role_id TEXT;
  manager_role_id TEXT;
BEGIN
  SELECT "id" INTO old_role_id FROM "roles" WHERE "role_key" = 'MULTI_SHOP_EMPLOYEE';
  SELECT "id" INTO manager_role_id FROM "roles" WHERE "role_key" = 'MANAGER';

  IF old_role_id IS NOT NULL AND manager_role_id IS NULL THEN
    UPDATE "roles"
    SET "role_key" = 'MANAGER',
        "role_name" = 'Manager',
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = old_role_id;
  ELSIF old_role_id IS NOT NULL AND manager_role_id IS NOT NULL THEN
    INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
    SELECT manager_role_id, "permission_id", "created_at"
    FROM "role_permissions"
    WHERE "role_id" = old_role_id
    ON CONFLICT DO NOTHING;

    INSERT INTO "user_roles" ("user_id", "role_id", "created_at")
    SELECT "user_id", manager_role_id, "created_at"
    FROM "user_roles"
    WHERE "role_id" = old_role_id
    ON CONFLICT DO NOTHING;

    DELETE FROM "roles" WHERE "id" = old_role_id;
  END IF;
END $$;

-- Invalidate existing JWT access/refresh tokens for accounts whose role was remapped.
UPDATE "users"
SET "updated_at" = GREATEST(CURRENT_TIMESTAMP, "updated_at" + INTERVAL '1 millisecond')
WHERE "role" = 'manager';

ALTER TABLE "audit_logs"
ADD COLUMN "actor_snapshot" JSONB;

ALTER TABLE "audit_logs"
ADD COLUMN "shop_snapshot" JSONB;
