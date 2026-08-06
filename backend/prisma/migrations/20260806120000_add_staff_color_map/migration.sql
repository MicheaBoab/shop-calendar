-- CreateTable
CREATE TABLE "staff_color_map" (
    "staff_name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_color_map_pkey" PRIMARY KEY ("staff_name")
);
