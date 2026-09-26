-- DropForeignKey
ALTER TABLE "AdminActionLog" DROP CONSTRAINT "AdminActionLog_adminId_fkey";

-- AlterTable
ALTER TABLE "AdminActionLog" ALTER COLUMN "adminId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
