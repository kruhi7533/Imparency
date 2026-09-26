-- CreateTable
CREATE TABLE "AdminInboxVisit" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "lastVisitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousVisitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInboxVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminInboxVisit_adminId_key" ON "AdminInboxVisit"("adminId");

-- AddForeignKey
ALTER TABLE "AdminInboxVisit" ADD CONSTRAINT "AdminInboxVisit_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
