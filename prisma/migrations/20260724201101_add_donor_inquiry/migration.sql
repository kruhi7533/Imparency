-- CreateTable
CREATE TABLE "DonorInquiry" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'General Inquiry',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonorInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorInquiryMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonorInquiryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DonorInquiry_ngoId_idx" ON "DonorInquiry"("ngoId");

-- CreateIndex
CREATE INDEX "DonorInquiry_donorId_idx" ON "DonorInquiry"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "DonorInquiry_ngoId_donorId_key" ON "DonorInquiry"("ngoId", "donorId");

-- CreateIndex
CREATE INDEX "DonorInquiryMessage_threadId_idx" ON "DonorInquiryMessage"("threadId");

-- AddForeignKey
ALTER TABLE "DonorInquiry" ADD CONSTRAINT "DonorInquiry_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorInquiry" ADD CONSTRAINT "DonorInquiry_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorInquiryMessage" ADD CONSTRAINT "DonorInquiryMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DonorInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
