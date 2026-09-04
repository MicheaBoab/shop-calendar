-- Backfill: all pre-existing data belongs to the original shop, "Prosper"
UPDATE "users" SET "shop_id" = 'prosper' WHERE "shop_id" IS NULL;
UPDATE "appointments" SET "shop_id" = 'prosper' WHERE "shop_id" IS NULL;
UPDATE "staff_color_map" SET "shop_id" = 'prosper' WHERE "shop_id" IS NULL;
UPDATE "audit_logs" SET "shop_id" = 'prosper' WHERE "shop_id" IS NULL;
UPDATE "system_settings" SET "shop_id" = 'prosper' WHERE "shop_id" IS NULL;
