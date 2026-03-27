-- AlterTable
ALTER TABLE "ActionIntent" ADD COLUMN "dispatch_error_code" TEXT;
ALTER TABLE "ActionIntent" ADD COLUMN "dispatch_error_message" TEXT;

-- AlterTable
ALTER TABLE "DecisionJob" ADD COLUMN "last_error_code" TEXT;
ALTER TABLE "DecisionJob" ADD COLUMN "last_error_stage" TEXT;
