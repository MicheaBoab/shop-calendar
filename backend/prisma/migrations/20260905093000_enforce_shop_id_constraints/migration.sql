-- users: enforce NOT NULL + FK + index
ALTER TABLE "users" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_shop_id_idx" ON "users"("shop_id");

-- appointments: enforce NOT NULL + FK + index
ALTER TABLE "appointments" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "appointments_shop_id_start_at_end_at_idx" ON "appointments"("shop_id", "start_at", "end_at");

-- audit_logs: enforce NOT NULL + FK + index
ALTER TABLE "audit_logs" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "audit_logs_shop_id_idx" ON "audit_logs"("shop_id");

-- staff_color_map: swap single-column PK for a composite (shop_id, staff_name) PK
ALTER TABLE "staff_color_map" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "staff_color_map" DROP CONSTRAINT "staff_color_map_pkey";
ALTER TABLE "staff_color_map" ADD CONSTRAINT "staff_color_map_pkey" PRIMARY KEY ("shop_id", "staff_name");
ALTER TABLE "staff_color_map" ADD CONSTRAINT "staff_color_map_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- system_settings: swap singleton int PK for shop_id PK (one row per shop)
ALTER TABLE "system_settings" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_pkey";
ALTER TABLE "system_settings" DROP COLUMN "id";
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("shop_id");
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
