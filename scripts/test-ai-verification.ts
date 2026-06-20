import prisma from "../lib/prisma";
import { verifyNGODocuments } from "../lib/gemini/verify-ngo-docs";

async function runAIVerificationTests() {
  console.log("Starting NGO Document AI Verification Agent tests...");

  const testSuffix = `ai-test-${Date.now()}`;

  // 1. Create NGO Owner User
  const ngoUser = await prisma.user.create({
    data: {
      email: `ngo-owner-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "NGO Owner AI Test"
    }
  });

  // 2. Create NGO Profile
  const ngoProfile = await prisma.nGOProfile.create({
    data: {
      userId: ngoUser.id,
      orgName: "AI Audit NGO Corp",
      registrationNumber: `REG-${testSuffix}`,
      panNumber: `PAN-${testSuffix}`,
      address: "Bangalore, India",
      causeCategories: ["Education"],
      verificationStatus: "PENDING",
      description: "AI verification test organization.",
      foundedYear: 2020
    }
  });

  console.log("Created test profile. Testing successful verification (mock)...");
  
  // 3. Test verification agent (mock)
  const report = await verifyNGODocuments(
    ngoProfile.id,
    "AI Audit NGO Corp",
    `REG-${testSuffix}`,
    `PAN-${testSuffix}`,
    [
      { buffer: Buffer.from("mock registration cert"), filename: "registration.pdf", mimeType: "application/pdf" },
      { buffer: Buffer.from("mock pan copy"), filename: "pan.pdf", mimeType: "application/pdf" },
      { buffer: Buffer.from("mock 80g copy"), filename: "80g.pdf", mimeType: "application/pdf" }
    ]
  );

  console.log("Report generated:", JSON.stringify(report, null, 2));

  if (!report.extracted_data || report.consistency_score === undefined || !report.recommendation) {
    throw new Error("Invalid report structure returned by verifyNGODocuments");
  }

  // 4. Test duplicate PAN/Reg fraud detection
  console.log("Testing duplicate registration detection...");
  // Create another NGO with the same registration number
  const duplicateUser = await prisma.user.create({
    data: {
      email: `duplicate-ngo-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Duplicate NGO Owner"
    }
  });

  const duplicateProfile = await prisma.nGOProfile.create({
    data: {
      userId: duplicateUser.id,
      orgName: "Copycat NGO",
      registrationNumber: `REG-OTHER-${testSuffix}`, // unique in DB!
      panNumber: `PAN-OTHER-${testSuffix}`, // unique in DB!
      address: "Bangalore, India",
      causeCategories: ["Education"],
      verificationStatus: "PENDING",
      description: "AI verification duplicate test organization.",
      foundedYear: 2021
    }
  });

  const fraudReport = await verifyNGODocuments(
    duplicateProfile.id,
    "Copycat NGO",
    `REG-${testSuffix}`, // Pass registration number of the first NGO to trigger duplicate detection!
    `PAN-OTHER-${testSuffix}`,
    [
      { buffer: Buffer.from("mock registration cert"), filename: "registration.pdf", mimeType: "application/pdf" },
      { buffer: Buffer.from("mock pan copy"), filename: "pan.pdf", mimeType: "application/pdf" },
      { buffer: Buffer.from("mock 80g copy"), filename: "80g.pdf", mimeType: "application/pdf" }
    ]
  );

  console.log("Fraud Report generated:", JSON.stringify(fraudReport, null, 2));

  if (fraudReport.recommendation !== "LIKELY_FRAUD") {
    throw new Error(`Expected recommendation LIKELY_FRAUD for duplicate details, got ${fraudReport.recommendation}`);
  }

  const hasDuplicateFlag = fraudReport.flags.some(f => f.issue.toLowerCase().includes("duplicate"));
  if (!hasDuplicateFlag) {
    throw new Error("Expected a flag pointing to duplicate details in database.");
  }

  console.log("All AI verification agent test assertions passed successfully!");

  // Cleanup
  console.log("Cleaning up database test records...");
  await prisma.nGOProfile.deleteMany({
    where: { id: { in: [ngoProfile.id, duplicateProfile.id] } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ngoUser.id, duplicateUser.id] } }
  });

  console.log("Cleanup complete. NGO Document AI Verification Agent tests passed!");
}

runAIVerificationTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
