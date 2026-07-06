import prisma from "../lib/prisma";
import { recalculateNGOHealthScore } from "../lib/ngo-health";
import { checkPANUsage } from "../lib/fraud-alerts";
import { checkGeminiScore } from "../lib/risk-agent";

async function runPhase5Tests() {
  console.log("Starting Phase 5: Health Score Engine & Fraud Alerts integration tests...");

  const testSuffix = `test-${Date.now()}`;

  // 1. Create corporate donor user
  const corporateDonor = await prisma.user.create({
    data: {
      email: `corp-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Corporate Client Ltd",
      isCorporate: true,
      companyName: "Corporate Client Ltd",
      gstNumber: "22AAAAA0000A1Z5"
    }
  });

  // Create two other donor users to meet the unique donor count criteria for health scores (min 3)
  const donor2 = await prisma.user.create({
    data: {
      email: `donor2-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Test Donor 2"
    }
  });

  const donor3 = await prisma.user.create({
    data: {
      email: `donor3-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Test Donor 3"
    }
  });

  // 2. Create NGO User and Profile
  const ngoUser = await prisma.user.create({
    data: {
      email: `ngo-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "NGO Owner"
    }
  });

  const ngoProfile = await prisma.nGOProfile.create({
    data: {
      userId: ngoUser.id,
      orgName: "Transparency NonProfit",
      registrationNumber: `REG-${testSuffix}`,
      panNumber: `ABCDE1234F-${testSuffix}`,
      address: "Mumbai, India",
      causeCategories: ["Education", "Healthcare"],
      verificationStatus: "VERIFIED",
      description: "Working towards transparent education systems.",
      foundedYear: 2018
    }
  });

  // 3. Create Project
  const project = await prisma.project.create({
    data: {
      ngoId: ngoProfile.id,
      title: "Clean Drinking Water Campaign",
      description: "Install water filters in schools",
      causeCategory: "Healthcare",
      targetAmount: 50000,
      raisedAmount: 30000,
      status: "ACTIVE",
      coverImage: "http://example.com/cover.jpg",
      location: "Maharashtra, India"
    }
  });

  // 4. Create milestones
  const milestone1 = await prisma.milestone.create({
    data: {
      projectId: project.id,
      title: "Procure water filters",
      description: "Buy 10 industrial filters",
      targetAmount: 15000,
      deadline: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // deadline 5 days ago
      status: "PENDING",
      sequenceOrder: 1
    }
  });

  const milestone2 = await prisma.milestone.create({
    data: {
      projectId: project.id,
      title: "Installation in schools",
      description: "Install filters and verify",
      targetAmount: 15000,
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // deadline 10 days in future
      status: "PENDING",
      sequenceOrder: 2
    }
  });

  console.log("Initial state setup complete. Testing score starting state (pending)...");

  // Test: Recalculate health score when milestones completed < 1 or donors < 3. Should default to null.
  await recalculateNGOHealthScore(ngoProfile.id);

  let updatedProfile = await prisma.nGOProfile.findUnique({
    where: { id: ngoProfile.id }
  });

  console.log(`NGO Health Score: ${updatedProfile?.healthScore} (expected: null / pending)`);
  if (updatedProfile?.healthScore !== null) {
    throw new Error("Expected initial health score to be null (Pending status) since no milestones are completed yet.");
  }

  // 5. Complete Milestone 1 and create unique donations from 3 different donors to trigger numeric score calculation
  const donation1 = await prisma.donation.create({
    data: {
      donorId: corporateDonor.id,
      projectId: project.id,
      amount: 10000,
      razorpayOrderId: `ord1_${testSuffix}`,
      status: "SUCCESS"
    }
  });

  const donation2 = await prisma.donation.create({
    data: {
      donorId: donor2.id,
      projectId: project.id,
      amount: 10000,
      razorpayOrderId: `ord2_${testSuffix}`,
      status: "SUCCESS"
    }
  });

  const donation3 = await prisma.donation.create({
    data: {
      donorId: donor3.id,
      projectId: project.id,
      amount: 10000,
      razorpayOrderId: `ord3_${testSuffix}`,
      status: "SUCCESS"
    }
  });

  // Make donor2 donate again to give us a returning donor (1 returning donor out of 3 total unique = 33.3% return rate)
  await prisma.donation.create({
    data: {
      donorId: donor2.id,
      projectId: project.id,
      amount: 5000,
      razorpayOrderId: `ord4_${testSuffix}`,
      status: "SUCCESS"
    }
  });

  // Update milestone status to COMPLETED
  await prisma.milestone.update({
    where: { id: milestone1.id },
    data: { status: "COMPLETED" }
  });

  // Create a proof submitted today for milestone 1 (submitted 5 days after deadline)
  const proof = await prisma.milestoneProof.create({
    data: {
      milestoneId: milestone1.id,
      submittedById: ngoUser.id,
      description: "Water filters procured and bills submitted.",
      mediaUrls: ["http://example.com/filter-invoice.pdf"],
      documentUrls: ["http://example.com/filters.jpg"],
      submittedAt: new Date(),
      aiValidationScore: 80,
      aiValidationResult: JSON.stringify({ score: 80, reasoning: "Matched expectations.", flags: [] })
    }
  });

  console.log("Recalculating with 1 completed milestone and 3 unique donors...");
  await recalculateNGOHealthScore(ngoProfile.id);

  updatedProfile = await prisma.nGOProfile.findUnique({
    where: { id: ngoProfile.id }
  });

  console.log(`NGO Health Score: ${updatedProfile?.healthScore} / 100`);
  console.log("Breakdown:", JSON.stringify(updatedProfile?.healthScoreBreakdown, null, 2));

  if (updatedProfile?.healthScore === null) {
    throw new Error("Expected health score to be computed numerically since 1 milestone is completed and 3 unique donors exist.");
  }

  // Verify weight redistribution. Total unique donors is 3, which is < 5. So Donor Return Rate metric (20% weight) should be skipped!
  // This means utilization, completion, and speed weights should be scaled up!
  const breakdown = updatedProfile?.healthScoreBreakdown as any;
  console.log("Redistributed weights checking:");
  console.log(` - Fund Utilization Weight: ${breakdown?.utilization?.weight} (expected: ~36.67%)`);
  console.log(` - Milestone Completion Weight: ${breakdown?.completion?.weight} (expected: ~36.67%)`);
  console.log(` - Proof Speed Weight: ${breakdown?.speed?.weight} (expected: ~26.67%)`);
  console.log(` - Donor Return Weight: ${breakdown?.donorReturn?.weight} (expected: 0%)`);

  if (breakdown?.donorReturn?.weight !== 0) {
    throw new Error("Expected Donor Return Rate metric to be skipped and have 0 weight since unique donors < 5.");
  }

  console.log("\nTesting Fraud Alerts...");

  // Test: Duplicate PAN Alert
  console.log("Testing PAN fraud alert...");
  const panNumber = `PAN-${testSuffix}`;
  // Set PAN on corporateDonor user record
  await prisma.user.update({
    where: { id: corporateDonor.id },
    data: { panNumber }
  });
  // Create another user with the same PAN
  const duplicateUser = await prisma.user.create({
    data: {
      email: `duplicate-${testSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Duplicate User",
      panNumber
    }
  });

  await checkPANUsage(panNumber, duplicateUser.id);
  let panAlert = await prisma.fraudAlert.findFirst({
    where: { type: "DUPLICATE_PAN_REGISTRATION", entityId: duplicateUser.id }
  });
  console.log("PAN Fraud Alert logged:", panAlert ? "YES" : "NO");
  if (!panAlert) {
    throw new Error("Expected a DUPLICATE_PAN_REGISTRATION alert to be created.");
  }

  // Test: Gemini Score < 40 Alert and Suspension
  console.log("Testing consecutive Gemini score alerts & auto-suspension...");

  // Update proof 1's validation score to 35 (< 40)
  await prisma.milestoneProof.update({
    where: { id: proof.id },
    data: { aiValidationScore: 35 }
  });
  
  // Trigger check 1
  await checkGeminiScore(milestone1.id, 35);
  let scoreAlert1 = await prisma.fraudAlert.findFirst({
    where: { type: "EXTREMELY_LOW_PROOF_SCORE", entityId: milestone1.id }
  });
  console.log("First Gemini score alert logged:", scoreAlert1 ? "YES" : "NO");
  if (!scoreAlert1) {
    throw new Error("Expected a EXTREMELY_LOW_PROOF_SCORE alert to be logged.");
  }

  // Create second proof for milestone 2 with score 30 (< 40)
  const proof2 = await prisma.milestoneProof.create({
    data: {
      milestoneId: milestone2.id,
      submittedById: ngoUser.id,
      description: "Water filter installation completion report.",
      mediaUrls: ["http://example.com/filter-photo.jpg"],
      documentUrls: ["http://example.com/filter-report.pdf"],
      submittedAt: new Date(),
      aiValidationScore: 30,
      aiValidationResult: JSON.stringify({ score: 30, reasoning: "Proof contains unconvincing evidence.", flags: ["BLURRY_PHOTOS"] })
    }
  });

  // Trigger check 2
  await checkGeminiScore(milestone2.id, 30);
  let consecutiveAlert = await prisma.fraudAlert.findFirst({
    where: { type: "CONSECUTIVE_LOW_SCORES_SUSPENSION", entityId: ngoProfile.id }
  });
  console.log("Consecutive low score alert logged:", consecutiveAlert ? "YES" : "NO");
  if (!consecutiveAlert) {
    throw new Error("Expected a CONSECUTIVE_LOW_SCORES_SUSPENSION alert to be logged.");
  }

  updatedProfile = await prisma.nGOProfile.findUnique({
    where: { id: ngoProfile.id }
  });
  console.log("NGO Suspended Status:", updatedProfile?.isSuspended ? "SUSPENDED" : "ACTIVE");
  if (!updatedProfile?.isSuspended) {
    throw new Error("Expected the NGO to be auto-suspended after two consecutive low Gemini scores.");
  }

  console.log("\nAll tests passed successfully! Cleaning up sandbox data...");

  // Cleanup sandbox
  await prisma.fraudAlert.deleteMany({
    where: { entityId: { in: [ngoProfile.id, milestone1.id, milestone2.id, duplicateUser.id] } }
  });
  await prisma.milestoneProof.deleteMany({
    where: { milestoneId: { in: [milestone1.id, milestone2.id] } }
  });
  await prisma.donation.deleteMany({
    where: { projectId: project.id }
  });
  await prisma.milestone.deleteMany({
    where: { projectId: project.id }
  });
  await prisma.project.delete({
    where: { id: project.id }
  });
  await prisma.nGOProfile.delete({
    where: { id: ngoProfile.id }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [corporateDonor.id, donor2.id, donor3.id, ngoUser.id, duplicateUser.id] } }
  });

  console.log("Clean up finished. Phase 5 integration tests complete.");
}

runPhase5Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
