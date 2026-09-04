-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_name_key" ON "shops"("name");

-- Seed the two initial shops
INSERT INTO "shops" ("id", "name", "created_at", "updated_at")
VALUES
  ('prosper', 'Prosper', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('anna', 'Anna', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
