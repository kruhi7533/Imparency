import { validateMilestoneProof } from "../lib/gemini/validate-proof";
import { generateImpactNarrative } from "../lib/gemini/generate-narrative";

async function testPrompts() {
  console.log("Starting Gemini Prompts test suite...");

  const mockMilestone = {
    title: "Buy Textbooks for Rural School",
    description: "Purchase and distribute 200 science textbooks to grade 5 students in Pune district.",
    targetAmount: 15000,
    deadline: new Date("2026-08-30"),
    proofTypeRequired: "Receipt + Photo"
  };

  const proofDescription = "We successfully purchased 200 textbooks from the local distributor. Invoices are attached along with a photograph of the distribution ceremony where Pune district education officers were present.";

  const mockProject = {
    problemStatement: "Lack of educational materials in rural schools.",
    expectedOutcome: "Improved science literacy among Grade 5 students."
  };

  // 1. Test validateMilestoneProof (mock mode)
  console.log("Testing validateMilestoneProof (with dummy file buffer)...");
  const dummyBuffer = Buffer.from("dummy-photo-content");
  const validationResult = await validateMilestoneProof(
    mockMilestone,
    mockProject,
    proofDescription,
    [{ buffer: dummyBuffer, mimeType: "image/jpeg" }]
  );

  console.log("Validation Result:", validationResult);
  if (typeof validationResult.score !== "number" || !validationResult.reasoning) {
    throw new Error("Invalid validation result format");
  }
  console.log("PASS: validateMilestoneProof completed");

  // 2. Test generateImpactNarrative (mock mode)
  console.log("Testing generateImpactNarrative...");
  const narrative = await generateImpactNarrative(
    { name: "Aditi Sharma" },
    { amount: 3000 },
    { title: "Pune Science Literacy Campaign", raisedAmount: 15000 },
    { orgName: "Vidyoday Trust" },
    mockMilestone,
    proofDescription,
    "Hire Science Teacher"
  );

  console.log("Generated Narrative:\n", narrative);
  if (!narrative || narrative.length < 20) {
    throw new Error("Invalid narrative result format");
  }
  console.log("PASS: generateImpactNarrative completed");

  console.log("All prompt tests passed successfully!");
}

testPrompts().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
