-- AlterTable
ALTER TABLE "appointments"
  ADD COLUMN "group_id" TEXT;

-- CreateIndex
CREATE INDEX "appointments_group_id_idx" ON "appointments"("group_id");
