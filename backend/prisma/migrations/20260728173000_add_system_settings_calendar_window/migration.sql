CREATE TABLE "system_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "calendar_window_start" TEXT,
    "calendar_window_end" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);
