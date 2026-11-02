-- Only obsolete color mappings are discarded; historical snapshots are untouched.
DROP TABLE "staff_color_map";
CREATE TABLE "staff_color_map" (
  "shop_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_color_map_pkey" PRIMARY KEY ("shop_id", "user_id"),
  CONSTRAINT "staff_color_map_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_color_map_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staff_color_map_shop_id_color_key" ON "staff_color_map"("shop_id", "color");
CREATE TABLE "manager_color_map" (
  "user_id" TEXT NOT NULL PRIMARY KEY,
  "color" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_color_map_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
