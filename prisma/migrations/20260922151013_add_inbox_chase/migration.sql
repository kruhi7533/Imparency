-- CreateTable
CREATE TABLE "InboxChase" (
    "id" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxChase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboxChase_itemKey_key" ON "InboxChase"("itemKey");

-- CreateIndex
CREATE INDEX "InboxChase_expiresAt_idx" ON "InboxChase"("expiresAt");

-- AddForeignKey
ALTER TABLE "InboxChase" ADD CONSTRAINT "InboxChase_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
