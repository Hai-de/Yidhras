-- AlterTable
ALTER TABLE "Event" ADD COLUMN "location_id" TEXT;
ALTER TABLE "Event" ADD COLUMN "visibility" TEXT;

-- CreateIndex
CREATE INDEX "Event_location_id_tick_idx" ON "Event"("location_id", "tick");
