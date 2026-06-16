import prisma from "../lib/prisma";
import {
  triggerMilestoneCompleted,
  triggerProofApproved,
  triggerProofRejected,
  triggerFollowedNGONewProject,
  triggerNewDonationReceived
} from "../lib/notification-triggers";

async function runNotificationTests() {
  console.log("Starting notification integration tests...");

  // 1. Create a clean test suite sandbox
  const emailSuffix = `test-${Date.now()}`;
  
  // Create donor user
  const donorUser = await prisma.user.create({
    data: {
      email: `donor-${emailSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Test Donor",
      fcmToken: "mock-donor-fcm-token-12345"
    }
  });

  // Create NGO user
  const ngoUser = await prisma.user.create({
    data: {
      email: `ngo-${emailSuffix}@test.com`,
      passwordHash: "testpassword",
      name: "Test NGO Owner",
      fcmToken: "mock-ngo-fcm-token-67890"
    }
  });

  // Create NGO Profile
  const ngoProfile = await prisma.nGOProfile.create({
    data: {
      userId: ngoUser.id,
      orgName: "Test NGO Org",
      registrationNumber: `REG-${emailSuffix}`,
      panNumber: `PAN-${emailSuffix}`,
      address: "123 Test Street",
      causeCategories: ["Education"],
      verificationStatus: "VERIFIED",
      description: "Test NGO description",
      foundedYear: 2020
    }
  });

  // Create Follower record
  await prisma.nGOFollower.create({
    data: {
      donorId: donorUser.id,
      ngoId: ngoProfile.id
    }
  });

  // Create Project
  const project = await prisma.project.create({
    data: {
      ngoId: ngoProfile.id,
      title: "Test Campaign Project",
      description: "Testing campaign descriptions",
      causeCategory: "Education",
      targetAmount: 20000,
      raisedAmount: 10000,
      status: "ACTIVE",
      coverImage: "http://example.com/cover.jpg",
      location: "Pune, India"
    }
  });

  // Create Milestone 1
  const milestone1 = await prisma.milestone.create({
    data: {
      projectId: project.id,
      title: "Milestone One Test",
      description: "Buy tables and chairs",
      targetAmount: 10000,
      deadline: new Date(),
      status: "PROOF_SUBMITTED",
      sequenceOrder: 1
    }
  });

  // Create Milestone 2 (to act as the next milestone)
  const milestone2 = await prisma.milestone.create({
    data: {
      projectId: project.id,
      title: "Milestone Two Test",
      description: "Buy computer monitor",
      targetAmount: 10000,
      deadline: new Date(),
      status: "PENDING",
      sequenceOrder: 2
    }
  });

  // Create Donation
  const donation = await prisma.donation.create({
    data: {
      donorId: donorUser.id,
      projectId: project.id,
      amount: 5000,
      razorpayOrderId: `order_${emailSuffix}`,
      status: "SUCCESS"
    }
  });

  // Create Milestone Proof for Milestone 1
  const proof = await prisma.milestoneProof.create({
    data: {
      milestoneId: milestone1.id,
      submittedById: ngoUser.id,
      description: "We bought 10 tables and 20 chairs, invoices attached.",
      mediaUrls: ["http://example.com/photo.jpg"],
      documentUrls: ["http://example.com/invoice.pdf"],
      aiValidationScore: 85,
      aiValidationResult: JSON.stringify({
        score: 85,
        reasoning: "The invoices and photos align perfectly with the target milestone of buying classroom furniture.",
        flags: []
      })
    }
  });

  console.log("Database sandbox initialized. Running triggers...");

  // 2. Run Trigger: triggerNewDonationReceived
  console.log("\nTesting Trigger 1: triggerNewDonationReceived...");
  await triggerNewDonationReceived(donation.id);

  // 3. Run Trigger: triggerFollowedNGONewProject
  console.log("\nTesting Trigger 2: triggerFollowedNGONewProject...");
  await triggerFollowedNGONewProject(ngoProfile.id, project.id);

  // 4. Run Trigger: triggerMilestoneCompleted
  console.log("\nTesting Trigger 3: triggerMilestoneCompleted...");
  await triggerMilestoneCompleted(milestone1.id);

  // 5. Run Trigger: triggerProofApproved
  console.log("\nTesting Trigger 4: triggerProofApproved...");
  await triggerProofApproved(milestone1.id);

  // 6. Run Trigger: triggerProofRejected
  console.log("\nTesting Trigger 5: triggerProofRejected...");
  await triggerProofRejected(milestone1.id, "The receipt image is blurry and does not list items purchased.");

  console.log("\nAll triggers executed. Verifying DB Notification logs...");

  // 7. Verify Notification table entries
  const donorNotifications = await prisma.notification.findMany({
    where: { userId: donorUser.id },
    orderBy: { createdAt: "asc" }
  });

  const ngoNotifications = await prisma.notification.findMany({
    where: { userId: ngoUser.id },
    orderBy: { createdAt: "asc" }
  });

  console.log(`Donor Notification records found: ${donorNotifications.length}`);
  donorNotifications.forEach((n) => console.log(` - Donor Notification: [${n.title}] -> ${n.body}`));

  console.log(`NGO Notification records found: ${ngoNotifications.length}`);
  ngoNotifications.forEach((n) => console.log(` - NGO Notification: [${n.title}] -> ${n.body}`));

  // Assertions
  if (donorNotifications.length < 2) {
    throw new Error("Donor should have received at least 2 notifications (Project Publish + Milestone Completed)");
  }
  if (ngoNotifications.length < 3) {
    throw new Error("NGO should have received at least 3 notifications (New Donation + Proof Approved + Proof Rejected)");
  }

  // Verify ImpactReport was created
  const impactReports = await prisma.impactReport.findMany({
    where: { donorId: donorUser.id }
  });
  console.log(`Impact Reports generated: ${impactReports.length}`);
  if (impactReports.length === 0) {
    throw new Error("Expected an ImpactReport entry to be generated for the donor.");
  }
  console.log(` - Generated Impact Narrative: ${impactReports[0].aiGeneratedNarrative}`);

  console.log("\nCleaning up sandbox test data...");

  // 8. Sandbox Cleanup
  await prisma.notification.deleteMany({
    where: { userId: { in: [donorUser.id, ngoUser.id] } }
  });
  await prisma.impactReport.deleteMany({
    where: { donorId: donorUser.id }
  });
  await prisma.milestoneProof.deleteMany({
    where: { milestoneId: { in: [milestone1.id, milestone2.id] } }
  });
  await prisma.donation.deleteMany({
    where: { id: donation.id }
  });
  await prisma.milestone.deleteMany({
    where: { id: { in: [milestone1.id, milestone2.id] } }
  });
  await prisma.project.deleteMany({
    where: { id: project.id }
  });
  await prisma.nGOFollower.deleteMany({
    where: { donorId: donorUser.id, ngoId: ngoProfile.id }
  });
  await prisma.nGOProfile.delete({
    where: { id: ngoProfile.id }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [donorUser.id, ngoUser.id] } }
  });

  console.log("\nAll notification integration tests passed and sandbox cleaned up successfully!");
}

runNotificationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
