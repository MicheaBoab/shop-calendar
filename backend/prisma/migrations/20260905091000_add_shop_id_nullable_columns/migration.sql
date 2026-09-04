-- AlterTable: add nullable shop_id columns first so existing rows are not rejected
ALTER TABLE "users" ADD COLUMN "shop_id" TEXT;
ALTER TABLE "appointments" ADD COLUMN "shop_id" TEXT;
ALTER TABLE "staff_color_map" ADD COLUMN "shop_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "shop_id" TEXT;
ALTER TABLE "system_settings" ADD COLUMN "shop_id" TEXT;
