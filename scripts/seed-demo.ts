import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

// ─── NGO data ────────────────────────────────────────────────────────────────

const DEMO_NGOS = [
  {
    email: "akshar@demo.org",
    name: "Akshar Director",
    orgName: "Akshar Foundation",
    registrationNumber: "REG-AKSHAR-12345",
    panNumber: "PANAKSH123",
    address: "Bangalore, Karnataka",
    causeCategories: ["Education"],
    healthScore: 87,
    description: "Works on improving literacy and numeracy outcomes for government school children through teacher training and community learning centers.",
    foundedYear: 2012,
    website: "https://aksharfoundation.org",
    cover_image_url: "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Digital Classrooms Initiative",
        target: 300000, raised: 200000, location: "Bangalore Rural",
        coverImage: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Government school students lack access to digital learning tools, widening the educational gap with private schools.",
        expectedOutcome: "Equip 5 schools with active digital projectors and tablets, leading to 25% higher student engagement in science & math.",
        milestones: [
          { title: "Procurement of tablets and projectors", targetAmount: 120000, daysOffset: -60, status: "COMPLETED", withProof: true, proofScore: 91 },
          { title: "Installation and teacher training", targetAmount: 80000, daysOffset: 30, status: "PROOF_SUBMITTED", withProof: true, proofScore: 74 },
          { title: "Student outcome assessment", targetAmount: 100000, daysOffset: 90, status: "PENDING" }
        ]
      },
      {
        title: "Teacher Training Bootcamp",
        target: 200000, raised: 182000, location: "Bangalore Urban",
        coverImage: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Many rural teachers lack training in modern active-learning pedagogies.",
        expectedOutcome: "Train 50 rural school teachers who will implement active-learning strategies for over 2,000 primary school students.",
      },
      {
        title: "Rural Literacy Kits",
        target: 150000, raised: 100000, location: "Mysore",
        coverImage: "",
        problemStatement: "Children in remote villages do not own age-appropriate reading books.",
        expectedOutcome: "Distribute 500 literacy kits, improving basic reading competency by 30% in 6 months.",
      }
    ]
  },
  {
    email: "jeevan@demo.org",
    name: "Jeevan Coordinator",
    orgName: "Jeevan Health Mission",
    registrationNumber: "REG-JEEVAN-23456",
    panNumber: "PANJEEV234",
    address: "Pune, Maharashtra",
    causeCategories: ["Healthcare"],
    healthScore: 92,
    description: "Provides free mobile health clinics and maternal care services to underserved rural communities.",
    foundedYear: 2009,
    website: "https://jeevanhealth.org",
    cover_image_url: "https://images.unsplash.com/photo-1584515906207-52c616682b15?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Mobile Clinic Van",
        target: 500000, raised: 400000, location: "Pune District",
        coverImage: "https://images.unsplash.com/photo-1516550893923-42d28e5677af?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Villagers in remote Pune districts travel over 30km to access basic primary healthcare.",
        expectedOutcome: "Launch 1 fully-equipped mobile van providing weekly medical consultations to 10 village clusters.",
        milestones: [
          { title: "Van purchase and equipment fit-out", targetAmount: 200000, daysOffset: -90, status: "COMPLETED", withProof: true, proofScore: 88 },
          { title: "Staff training and route planning", targetAmount: 100000, daysOffset: -30, status: "COMPLETED", withProof: true, proofScore: 82 },
          { title: "First 3-month operational report", targetAmount: 100000, daysOffset: 45, status: "PROOF_SUBMITTED", withProof: true, proofScore: 31 },
          { title: "Coverage expansion to 3 more villages", targetAmount: 100000, daysOffset: 120, status: "PENDING" }
        ]
      },
      {
        title: "Maternal Health Support",
        target: 400000, raised: 315500, location: "Satara Rural",
        coverImage: "",
        problemStatement: "High rates of home births and lack of prenatal checkups lead to high maternal and infant mortality.",
        expectedOutcome: "Provide prenatal screening to 150 pregnant women, encouraging safe institutional deliveries.",
      }
    ]
  },
  {
    email: "greenroots@demo.org",
    name: "GreenRoots Lead",
    orgName: "Green Roots Collective",
    registrationNumber: "REG-GREEN-34567",
    panNumber: "PANGREE345",
    address: "Dehradun, Uttarakhand",
    causeCategories: ["Environment"],
    healthScore: 76,
    description: "Runs reforestation drives and community-led waste management programs across the Himalayan foothills.",
    foundedYear: 2015,
    website: "https://greenrootscollective.org",
    cover_image_url: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Himalayan Forestation Drive",
        target: 100000, raised: 80000, location: "Mussoorie Hills",
        coverImage: "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Deforestation in the Himalayan foothills has led to soil erosion, frequent landslides, and loss of local water springs.",
        expectedOutcome: "Plant 2,000 native tree saplings with local community caretaking, securing topsoil and restoring local habitats.",
        milestones: [
          { title: "Sapling Procurement & Land Prep", targetAmount: 40000, daysOffset: -40, status: "COMPLETED", withProof: true, proofScore: 79 },
          { title: "Planting Phase & Soil Inoculation", targetAmount: 40000, daysOffset: 20, status: "IN_PROGRESS" },
          { title: "Post-Monsoon Survival Audit", targetAmount: 40000, daysOffset: 120, status: "PENDING" }
        ]
      },
      {
        title: "Riverbank Cleanup Campaigns",
        target: 100000, raised: 80000, location: "Haridwar",
        coverImage: "https://images.unsplash.com/photo-1618477388954-7852f32655ec?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Solid waste and plastics dumped along the Ganges riverbank pollute the water and harm aquatic life.",
        expectedOutcome: "Conduct 15 cleanup campaigns, removing 5 tons of plastic waste and installing public waste bins.",
      }
    ]
  },
  {
    email: "sahaara@demo.org",
    name: "Sahaara Trustee",
    orgName: "Sahaara Women's Trust",
    registrationNumber: "REG-SAHAARA-45678",
    panNumber: "PANSAHA456",
    address: "Jaipur, Rajasthan",
    causeCategories: ["Women Empowerment"],
    healthScore: 95,
    description: "Trains rural women in vocational skills and provides micro-loans to help them start small businesses.",
    foundedYear: 2011,
    website: "https://sahaarawomen.org",
    cover_image_url: "https://images.unsplash.com/photo-1489533119213-66a5cd877091?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Sewing Training Centers",
        target: 500000, raised: 320000, location: "Jaipur Rural",
        coverImage: "https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Unemployed rural women lack marketable skills, leaving them financially dependent and vulnerable.",
        expectedOutcome: "Train 100 women in textile design and tailoring, enabling them to earn a sustainable monthly income.",
        milestones: [
          { title: "Training center setup and materials", targetAmount: 150000, daysOffset: -50, status: "COMPLETED", withProof: true, proofScore: 95 },
          { title: "First batch graduation and placement", targetAmount: 170000, daysOffset: 40, status: "IN_PROGRESS" }
        ]
      },
      {
        title: "Micro-loans for Women Artisans",
        target: 500000, raised: 320000, location: "Jodhpur District",
        coverImage: "",
        problemStatement: "Traditional women craftmakers lack capital to buy raw materials or market their products.",
        expectedOutcome: "Disburse interest-free micro-loans to 40 artisans, increasing their business profits by 40%.",
      }
    ]
  },
  {
    email: "pragati@demo.org",
    name: "Pragati Director",
    orgName: "Pragati Skills Institute",
    registrationNumber: "REG-PRAGATI-55001",
    panNumber: "PANPRAG551",
    address: "Nagpur, Maharashtra",
    causeCategories: ["Livelihood"],
    healthScore: 74,
    description: "Runs free vocational training programs in welding, tailoring, and electrical work for out-of-school youth.",
    foundedYear: 2017,
    website: "https://pragatiskills.org",
    cover_image_url: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=600&q=80",
    fcraScenario: "PENDING",
    projects: [
      {
        title: "Youth Welding Certification Program",
        target: 250000, raised: 140000, location: "Nagpur Industrial Area",
        coverImage: "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Young school dropouts in Nagpur lack certified vocational skills, leaving them unemployable in the growing industrial sector.",
        expectedOutcome: "Certify 80 youth in arc welding within 6 months, with 70% job placement in local factories.",
        milestones: [
          { title: "Workshop setup and equipment purchase", targetAmount: 100000, daysOffset: -45, status: "COMPLETED", withProof: true, proofScore: 83 },
          { title: "First batch training completion", targetAmount: 90000, daysOffset: -5, status: "PROOF_SUBMITTED", withProof: true, proofScore: 69 },
          { title: "Placement drive and outcome report", targetAmount: 60000, daysOffset: 60, status: "PENDING" }
        ]
      },
      {
        title: "Electrical Technician Track",
        target: 180000, raised: 90000, location: "Nagpur Peri-urban",
        coverImage: "",
        problemStatement: "Demand for licensed electricians in Nagpur's residential expansion is unmet due to lack of trained workers.",
        expectedOutcome: "Train 50 youth as certified electricians to meet local housing project demand.",
      }
    ]
  },
  {
    email: "balsansar@demo.org",
    name: "Bal Sansar Director",
    orgName: "Bal Sansar Foundation",
    registrationNumber: "REG-BALSANSAR-66001",
    panNumber: "PANBAL661",
    address: "Bhopal, Madhya Pradesh",
    causeCategories: ["Child Welfare"],
    healthScore: 91,
    description: "Provides nutrition, education, and legal protection support to orphaned and street children across Madhya Pradesh.",
    foundedYear: 2010,
    website: "https://balsansar.org",
    cover_image_url: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=600&q=80",
    fcraScenario: "NONE",
    projects: [
      {
        title: "Child Nutrition & Learning Centers",
        target: 400000, raised: 370000, location: "Bhopal Slum Clusters",
        coverImage: "https://images.unsplash.com/photo-1547226706-64d42a5f8c10?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Malnourished street children in Bhopal miss school due to hunger, creating a cycle of poverty and illiteracy.",
        expectedOutcome: "Run 5 day-care centers serving 300 children daily with nutrition and basic literacy, reducing dropout rates by 40%.",
        milestones: [
          { title: "Center setup and hiring of caretakers", targetAmount: 120000, daysOffset: -80, status: "COMPLETED", withProof: true, proofScore: 94 },
          { title: "First quarter nutrition and attendance data", targetAmount: 140000, daysOffset: -20, status: "COMPLETED", withProof: true, proofScore: 89 },
          { title: "6-month outcome assessment report", targetAmount: 80000, daysOffset: 10, status: "PROOF_SUBMITTED", withProof: true, proofScore: 77 },
          { title: "Program scale-up to 2 new clusters", targetAmount: 60000, daysOffset: 90, status: "PENDING" }
        ]
      },
      {
        title: "Legal Aid for Street Children",
        target: 150000, raised: 130000, location: "Bhopal City",
        coverImage: "https://images.unsplash.com/photo-1529390079861-591de354faf5?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Street children face harassment and have no access to birth certificates or identity documents, blocking their access to welfare schemes.",
        expectedOutcome: "Provide legal support to 100 children to obtain Aadhaar and birth certificates, unlocking access to government entitlements.",
      }
    ]
  },
  {
    email: "annaseva@demo.org",
    name: "AnnaSeva Organizer",
    orgName: "Anna Seva Foundation",
    registrationNumber: "REG-ANNASEVA-67890",
    panNumber: "PANANNA678",
    address: "Chennai, Tamil Nadu",
    causeCategories: ["Hunger"],
    healthScore: 68,
    description: "Operates community kitchens and food distribution drives for daily-wage workers in urban Chennai.",
    foundedYear: 2014,
    website: "https://annaseva.org",
    cover_image_url: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Daily Community Kitchen",
        target: 200000, raised: 100000, location: "Chennai Slums",
        coverImage: "https://images.unsplash.com/photo-1591389703635-e15a07b842d7?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Daily-wage workers and homeless seniors in Chennai go to bed hungry due to loss of livelihoods.",
        expectedOutcome: "Serve 500 hot, nutritious meals daily for 6 months, improving health and reducing malnutrition.",
        milestones: [
          { title: "Kitchen equipment & supply chain setup", targetAmount: 80000, daysOffset: -70, status: "COMPLETED", withProof: true, proofScore: 65 },
          { title: "First month operations report", targetAmount: 60000, daysOffset: -10, status: "PROOF_SUBMITTED", withProof: true, proofScore: 38 },
          { title: "6-month impact documentation", targetAmount: 60000, daysOffset: 80, status: "PENDING" }
        ]
      },
      {
        title: "Fisherfolk Breakfast Drive",
        target: 150000, raised: 95000, location: "Chennai Coastal",
        coverImage: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Fishermen starting work at 3 AM often skip breakfast, affecting their health.",
        expectedOutcome: "Provide early-morning high-protein breakfasts to 250 fishermen daily.",
      }
    ]
  }
];

// ─── Pending NGOs for admin verification panel ────────────────────────────────

const PENDING_NGOS = [
  {
    email: "newlight@demo.org",
    name: "NewLight Director",
    orgName: "NewLight Education Society",
    registrationNumber: "REG-NEWLIGHT-99001",
    panNumber: "PANNEW7890",
    address: "Hyderabad, Telangana",
    causeCategories: ["Education"],
    description: "Provides free evening coaching classes to underprivileged students preparing for competitive exams.",
    foundedYear: 2020,
    website: null,
    aiReport: {
      extracted_data: { org_name: "NewLight Education Society", registration_number: "REG-NEWLIGHT-99001", pan_number: "PANNEW7890", ngo_8og_number: null, validity_notes: "80G certificate missing" },
      consistency_score: 72,
      flags: [
        { severity: "HIGH", issue: "80G Registration Copy not uploaded — tax exemption status cannot be confirmed.", category: "DOCUMENT_ERROR" },
        { severity: "LOW", issue: "Minor formatting difference in organization name on PAN card vs registration.", category: "DOCUMENT_ERROR" }
      ],
      recommendation: "REVIEW_CAREFULLY",
      summary: "Registration certificate and PAN card match form data. However, the 80G document is missing, preventing full tax exemption verification."
    }
  },
  {
    email: "shadowcorp@demo.org",
    name: "Shadow Corp",
    orgName: "Shadow Welfare Corp",
    registrationNumber: "REG-SHADOW-DEMO-99",
    panNumber: "PANFAKE999",
    address: "Mumbai, Maharashtra",
    causeCategories: ["Education"],
    description: "Provides welfare services to underprivileged communities.",
    foundedYear: 2022,
    website: null,
    aiReport: {
      extracted_data: { org_name: "XYZ Holdings Ltd", registration_number: "REG-AKSHAR-12345", pan_number: "PANFAKE999", ngo_8og_number: null, validity_notes: null },
      consistency_score: 18,
      flags: [
        { severity: "HIGH", issue: "Organization name in uploaded documents ('XYZ Holdings Ltd') does not match submitted name ('Shadow Welfare Corp') — major mismatch indicating possible fraudulent submission.", category: "FRAUD_ALERT" },
        { severity: "HIGH", issue: "Duplicate registration number REG-AKSHAR-12345 already belongs to another verified NGO in the system.", category: "FRAUD_ALERT" },
        { severity: "HIGH", issue: "Uploaded documents appear to be scanned copies of another organization's certificates with modified text, suggesting tampering.", category: "FRAUD_ALERT" }
      ],
      recommendation: "LIKELY_FRAUD",
      summary: "All three documents show a completely different organization name. Registration number is a duplicate of an existing verified NGO. High confidence this is a fraudulent submission."
    }
  }
];

// ─── Donor data ───────────────────────────────────────────────────────────────

const DEMO_DONORS = [
  {
    email: "priya.sharma@demo.com",
    name: "Priya Sharma",
    donorCategory: "INDIAN_IN_INDIA" as const,
    nriSourceDeclaration: null,
    // Indian domestic donor — FCRA gate never applies
  },
  {
    email: "rahul.mehta@demo.com",
    name: "Rahul Mehta",
    donorCategory: "INDIAN_IN_INDIA" as const,
    nriSourceDeclaration: null,
  },
  {
    email: "sunita.rao@demo.com",
    name: "Sunita Rao",
    donorCategory: "INDIAN_IN_INDIA" as const,
    nriSourceDeclaration: null,
  },
  {
    email: "amit.nri@demo.com",
    name: "Amit Verma (NRI)",
    donorCategory: "INDIAN_ABROAD" as const,
    nriSourceDeclaration: "ELIGIBLE_NRI_SOURCE",
    // NRI with FEMA-compliant NRE account — gate does NOT apply
  },
  {
    email: "sarah.foreign@demo.com",
    name: "Sarah Mitchell (Foreign)",
    donorCategory: "FOREIGN_NATIONAL" as const,
    nriSourceDeclaration: null,
    // Foreign national — FCRA gate ALWAYS applies
  },
  {
    email: "rajan.abroad@demo.com",
    name: "Rajan Kumar (Abroad, Foreign Source)",
    donorCategory: "INDIAN_ABROAD" as const,
    nriSourceDeclaration: "FOREIGN_SOURCE",
    // NRI using foreign account — FCRA gate applies
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function randomRazorpayId() {
  return "pay_demo_" + Math.random().toString(36).substring(2, 14);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌱 Starting demo seed...\n");

  const passwordHash = await bcrypt.hash("demoPassword123", 10);

  // ── 1. Admin ──────────────────────────────────────────────────────────────
  let admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    const adminHash = await bcrypt.hash("adminpassword123", 10);
    admin = await prisma.user.create({
      data: { name: "Platform Admin", email: "admin@impactbridge.com", passwordHash: adminHash, role: "ADMIN" }
    });
    console.log("✅ Admin created — admin@impactbridge.com / adminpassword123");
  } else {
    console.log(`✅ Admin exists — ${admin.email}`);
  }

  // ── 2. Verified NGOs ─────────────────────────────────────────────────────
  const ngoProfileIds: Record<string, string> = {};
  let auditTrailCount = 0;

  for (const demo of DEMO_NGOS) {
    process.stdout.write(`  NGO: ${demo.orgName}...`);

    const existing = await prisma.user.findUnique({ where: { email: demo.email } });
    if (existing) {
      const existingNGO = await prisma.nGOProfile.findUnique({ where: { userId: existing.id } });
      if (existingNGO) {
        const projects = await prisma.project.findMany({ where: { ngoId: existingNGO.id } });
        for (const p of projects) {
          const milestones = await prisma.milestone.findMany({ where: { projectId: p.id } });
          for (const m of milestones) {
            await prisma.milestoneReview.deleteMany({ where: { milestoneId: m.id } });
            await prisma.milestoneProof.deleteMany({ where: { milestoneId: m.id } });
          }
          await prisma.milestone.deleteMany({ where: { projectId: p.id } });
          await prisma.donation.deleteMany({ where: { projectId: p.id } });
        }
        await prisma.project.deleteMany({ where: { ngoId: existingNGO.id } });
        await prisma.nGOFollower.deleteMany({ where: { ngoId: existingNGO.id } });
        const existingCompliance = await prisma.nGOCompliance.findUnique({ where: { ngoId: existingNGO.id } });
        if (existingCompliance) {
          await prisma.complianceAuditLog.deleteMany({ where: { complianceId: existingCompliance.id } });
          await prisma.nGOCompliance.delete({ where: { id: existingCompliance.id } });
        }
        await prisma.nGOProfile.delete({ where: { id: existingNGO.id } });
      }
      await prisma.user.delete({ where: { id: existing.id } });
    }

    const user = await prisma.user.create({
      data: { email: demo.email, name: demo.name, passwordHash, role: "NGO" }
    });

    const profile = await prisma.nGOProfile.create({
      data: {
        userId: user.id,
        orgName: demo.orgName,
        registrationNumber: demo.registrationNumber,
        panNumber: demo.panNumber,
        address: demo.address,
        causeCategories: demo.causeCategories,
        verificationStatus: "VERIFIED",
        healthScore: demo.healthScore,
        description: demo.description,
        foundedYear: demo.foundedYear,
        website: demo.website,
        cover_image_url: demo.cover_image_url,
        documents: []
      }
    });

    ngoProfileIds[demo.email] = profile.id;

    // ── Compliance record + FCRA scenario ──
    // Explicit fcraScenario on the NGO entry takes priority; otherwise rotates 0-4.
    const ngoIdx = DEMO_NGOS.indexOf(demo);
    const explicitScenario = (demo as any).fcraScenario as string | undefined;
    const scenario = explicitScenario ?? (ngoIdx % 5);
    const now = new Date();
    let fcraData: any = { fcraStatus: "NONE" };
    if (scenario === 0 || scenario === 3 || scenario === "ACTIVE") {
      fcraData = {
        fcraNumber: `0944${10000 + ngoIdx}`,
        fcraStatus: "ACTIVE",
        fcraAuthority: "Ministry of Home Affairs",
        fcraRegisteredSince: 2018,
        fcraIssueDate: new Date("2018-04-01"),
        fcraExpiryDate: daysFromNow(900),
        fcraCertificateUrl: "/uploads/documents/demo-fcra.pdf",
      };
    } else if (scenario === 1 || scenario === "EXPIRING_SOON") {
      fcraData = {
        fcraNumber: `0944${10000 + ngoIdx}`,
        fcraStatus: "EXPIRING_SOON",
        fcraAuthority: "Ministry of Home Affairs",
        fcraRegisteredSince: 2019,
        fcraIssueDate: new Date("2019-06-15"),
        fcraExpiryDate: daysFromNow(60),
        fcraCertificateUrl: "/uploads/documents/demo-fcra.pdf",
      };
    } else if (scenario === 4 || scenario === "EXPIRED") {
      fcraData = {
        fcraNumber: `0944${10000 + ngoIdx}`,
        fcraStatus: "EXPIRED",
        fcraAuthority: "Ministry of Home Affairs",
        fcraRegisteredSince: 2015,
        fcraIssueDate: new Date("2015-01-10"),
        fcraExpiryDate: daysAgo(30),
        fcraCertificateUrl: "/uploads/documents/demo-fcra.pdf",
      };
    } else if (scenario === "PENDING") {
      fcraData = {
        fcraNumber: `0944${10000 + ngoIdx}`,
        fcraStatus: "PENDING",
        fcraAuthority: null,
        fcraRegisteredSince: null,
        fcraIssueDate: null,
        fcraExpiryDate: null,
        fcraCertificateUrl: "/uploads/documents/demo-fcra.pdf",
      };
    }

    const compliance = await prisma.nGOCompliance.create({
      data: {
        ngoId: profile.id,
        panVerified: true,
        panVerifiedAt: now,
        registrationVerified: true,
        registrationVerifiedAt: now,
        a12Verified: true,
        a12VerifiedAt: now,
        a12DocumentUrl: "/uploads/documents/demo-12a.pdf",
        eightyGVerified: true,
        eightyGVerifiedAt: now,
        ...fcraData,
        ...(fcraData.fcraStatus !== "NONE" ? { fcraVerifiedAt: now } : {}),
      },
    });

    // Trust-timeline audit entries.
    const timelineEvents: { event: string; detail: string }[] = [
      { event: "REGISTRATION_VERIFIED", detail: "Registration certificate verified." },
      { event: "PAN_VERIFIED", detail: "PAN verified." },
      { event: "80G_VERIFIED", detail: "80G certificate verified." },
      { event: "12A_VERIFIED", detail: "12A certificate verified." },
    ];
    if (fcraData.fcraStatus !== "NONE") {
      timelineEvents.push({ event: "FCRA_UPLOADED", detail: "NGO submitted FCRA certificate for review." });
      if (fcraData.fcraStatus === "EXPIRED") {
        timelineEvents.push({ event: "FCRA_APPROVED", detail: "FCRA verified." });
        timelineEvents.push({ event: "FCRA_EXPIRED", detail: "FCRA registration has expired." });
      } else {
        timelineEvents.push({ event: "FCRA_APPROVED", detail: "FCRA verified." });
      }
    }
    for (const ev of timelineEvents) {
      await prisma.complianceAuditLog.create({
        data: { complianceId: compliance.id, event: ev.event, detail: ev.detail },
      });
    }

    for (const p of demo.projects as any[]) {
      const project = await prisma.project.create({
        data: {
          ngoId: profile.id,
          title: p.title,
          description: `Help fund: ${p.title}. Donations go directly to audited milestones.`,
          causeCategory: demo.causeCategories[0],
          targetAmount: p.target,
          raisedAmount: p.raised,
          status: "ACTIVE",
          coverImage: p.coverImage || "",
          location: p.location,
          problem_statement: p.problemStatement || null,
          expected_outcome: p.expectedOutcome || null
        }
      });

      if (p.milestones && p.milestones.length > 0) {
        for (let i = 0; i < p.milestones.length; i++) {
          const m = p.milestones[i];
          const deadline = m.daysOffset < 0 ? daysAgo(Math.abs(m.daysOffset)) : daysFromNow(m.daysOffset);
          const milestone = await prisma.milestone.create({
            data: {
              projectId: project.id,
              title: m.title,
              description: `Deliverables for: ${m.title}`,
              targetAmount: m.targetAmount,
              deadline,
              status: m.status,
              sequenceOrder: i + 1
            }
          });

          // Add proof for milestones that need it
          if (m.withProof) {
            const aiResult = JSON.stringify({
              score: m.proofScore,
              reasoning: m.proofScore >= 70
                ? "Evidence clearly demonstrates milestone completion. Photos are clear and match stated deliverables."
                : "Some deliverables are documented but key evidence is missing or unclear. Photos are low quality.",
              flags: m.proofScore < 50 ? ["Primary evidence photos are blurry", "No third-party confirmation attached"] : [],
              suggestion: m.proofScore < 70 ? "Submit higher resolution images and include a field officer's sign-off letter." : null
            });

            const proof = await prisma.milestoneProof.create({
              data: {
                milestoneId: milestone.id,
                submittedById: user.id,
                description: `We have successfully completed: ${m.title}. All activities are documented with photos and field reports.`,
                mediaUrls: ["https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=600"],
                documentUrls: [],
                aiValidationResult: aiResult,
                aiValidationScore: m.proofScore,
                submittedAt: daysAgo(3)
              }
            });

            // For COMPLETED milestones, add up to 2 audit trail entries total
            if (m.status === "COMPLETED" && auditTrailCount < 2) {
              auditTrailCount++;
              await prisma.milestoneReview.create({
                data: {
                  milestoneId: milestone.id,
                  proofId: proof.id,
                  adminId: admin!.id,
                  action: auditTrailCount === 1 ? "APPROVED" : "REJECTED",
                  note: auditTrailCount === 1
                    ? "All deliverables verified. Photos and field reports match the milestone scope."
                    : "Initial submission lacked supporting receipts. NGO resubmitted and was approved on second attempt — this entry reflects the first rejection.",
                  aiScore: m.proofScore,
                  reviewedAt: daysAgo(auditTrailCount === 1 ? 2 : 4)
                }
              });
            }
          }
        }
      } else {
        await prisma.milestone.create({
          data: {
            projectId: project.id,
            title: "Initial Execution Phase",
            description: "Initiate local activities, resource procurement, and setup verification.",
            targetAmount: p.target,
            deadline: daysFromNow(60),
            status: "PENDING",
            sequenceOrder: 1
          }
        });
      }
    }

    console.log(" ✅");
  }

  // ── 3. Pending NGOs (for admin verification panel) ───────────────────────
  console.log("\n  Pending NGOs for admin review...");
  for (const pending of PENDING_NGOS) {
    process.stdout.write(`  Pending NGO: ${pending.orgName}...`);

    const existing = await prisma.user.findUnique({ where: { email: pending.email } });
    if (existing) {
      const existingNGO = await prisma.nGOProfile.findUnique({ where: { userId: existing.id } });
      if (existingNGO) {
        await prisma.ngoScreening.deleteMany({ where: { ngoId: existingNGO.id } });
        await prisma.nGOProfile.delete({ where: { id: existingNGO.id } });
      }
      await prisma.user.delete({ where: { id: existing.id } });
    }

    const user = await prisma.user.create({
      data: { email: pending.email, name: pending.name, passwordHash, role: "NGO" }
    });

    const profile = await prisma.nGOProfile.create({
      data: {
        userId: user.id,
        orgName: pending.orgName,
        registrationNumber: pending.registrationNumber,
        panNumber: pending.panNumber,
        address: pending.address,
        causeCategories: pending.causeCategories,
        verificationStatus: "PENDING",
        healthScore: null,
        description: pending.description,
        foundedYear: pending.foundedYear,
        website: pending.website,
        documents: [],
        ai_verification_report: pending.aiReport
      }
    });

    // Add screening result
    await prisma.ngoScreening.create({
      data: {
        ngoId: profile.id,
        summary: pending.aiReport.summary,
        extractedFields: pending.aiReport.extracted_data as any,
        documentChecklist: {
          registrationCertificate: { present: true, readable: true },
          panCard: { present: true, readable: true },
          taxExemption80G: { present: pending.aiReport.recommendation !== "LIKELY_FRAUD", readable: false, note: "80G not found or invalid" }
        } as any,
        consistencyOk: pending.aiReport.consistency_score > 60,
        flags: pending.aiReport.flags as any,
        recommendation: pending.aiReport.recommendation === "REVIEW_CAREFULLY" ? "NEEDS_REVIEW" : "LOOKS_PROBLEMATIC",
        confidence: pending.aiReport.consistency_score / 100,
        status: "READY"
      }
    });

    // Fraud alerts are seeded separately below — skip per-flag creation here

    console.log(" ✅");
  }

  // ── 4. Donors ─────────────────────────────────────────────────────────────
  console.log("\n  Donors...");
  const donorIds: string[] = [];

  for (const d of DEMO_DONORS) {
    process.stdout.write(`  Donor: ${d.name}...`);
    let donor = await prisma.user.findUnique({ where: { email: d.email } });
    if (!donor) {
      donor = await prisma.user.create({
        data: {
          email: d.email,
          name: d.name,
          passwordHash,
          role: "DONOR",
          donorCategory: d.donorCategory,
          donorCategoryDeclaredAt: new Date(),
          donorDeclarationVersion: "1.0",
          nriSourceDeclaration: d.nriSourceDeclaration ?? null,
        }
      });
    } else {
      // update category in case seed is re-run
      await prisma.user.update({
        where: { id: donor.id },
        data: {
          donorCategory: d.donorCategory,
          donorCategoryDeclaredAt: new Date(),
          donorDeclarationVersion: "1.0",
          nriSourceDeclaration: d.nriSourceDeclaration ?? null,
        }
      });
    }
    donorIds.push(donor.id);
    console.log(" ✅");
  }

  // ── 5. Donations ──────────────────────────────────────────────────────────
  console.log("\n  Seeding donations...");
  const allProjects = await prisma.project.findMany({ take: 6 });

  const donationSeeds = [
    { projectIdx: 0, donorIdx: 0, amount: 5000 },
    { projectIdx: 0, donorIdx: 1, amount: 10000 },
    { projectIdx: 1, donorIdx: 2, amount: 7500 },
    { projectIdx: 1, donorIdx: 0, amount: 12000 },
    { projectIdx: 2, donorIdx: 1, amount: 3000 },
    { projectIdx: 3, donorIdx: 2, amount: 25000 },
    { projectIdx: 4, donorIdx: 0, amount: 8000 },
    { projectIdx: 4, donorIdx: 1, amount: 4500 },
  ];

  for (const seed of donationSeeds) {
    const project = allProjects[seed.projectIdx];
    const donorId = donorIds[seed.donorIdx];
    if (!project || !donorId) continue;

    await prisma.donation.create({
      data: {
        donorId,
        projectId: project.id,
        amount: seed.amount,
        razorpayOrderId: "order_demo_" + Math.random().toString(36).substring(2, 12),
        razorpayPaymentId: randomRazorpayId(),
        status: "SUCCESS",
        createdAt: daysAgo(Math.floor(Math.random() * 30))
      }
    });
  }
  console.log("  ✅ Donations created");

  // ── 6. Fraud alerts — exactly 3 ──────────────────────────────────────────
  console.log("\n  Seeding fraud alerts...");

  // Wipe ALL existing alerts so reruns don't stack
  await prisma.fraudAlert.deleteMany({});

  const shadowProfile = await prisma.nGOProfile.findFirst({ where: { orgName: "Shadow Welfare Corp" } });
  const aksharProfile = await prisma.nGOProfile.findFirst({ where: { orgName: "Akshar Foundation" } });

  // 1. FRAUD_ALERT — tampered documents on Shadow Welfare Corp
  if (shadowProfile) {
    await prisma.fraudAlert.create({
      data: {
        type: "AI_DOCUMENT_VERIFICATION",
        entityId: shadowProfile.id,
        entityType: "NGO",
        description: "Organization name in uploaded documents ('XYZ Holdings Ltd') does not match submitted name ('Shadow Welfare Corp'). Signs of document tampering detected.",
        severity: "HIGH",
        alertCategory: "FRAUD_ALERT",
        subType: "TAMPERED_DOCUMENT",
        resolved: false,
        createdAt: daysAgo(1)
      }
    });
  }

  // 2. DOCUMENT_ERROR — missing 80G on Akshar Foundation
  if (aksharProfile) {
    await prisma.fraudAlert.create({
      data: {
        type: "AI_DOCUMENT_ERROR",
        entityId: aksharProfile.id,
        entityType: "NGO",
        description: "80G Registration Copy not uploaded — tax exemption status cannot be confirmed. NGO should resubmit with the correct document.",
        severity: "HIGH",
        alertCategory: "DOCUMENT_ERROR",
        subType: "MISSING_DOCUMENT",
        resolved: false,
        createdAt: daysAgo(2)
      }
    });
  }

  // 3. FCRA pending flag — Pragati Skills Institute uploaded cert but not yet reviewed
  const pragatiProfile = await prisma.nGOProfile.findFirst({ where: { orgName: "Pragati Skills Institute" } });
  if (pragatiProfile) {
    await prisma.fraudAlert.create({
      data: {
        type: "AI_DOCUMENT_VERIFICATION",
        entityId: pragatiProfile.id,
        entityType: "NGO",
        description: "FCRA certificate uploaded but registration number format does not match MHA's standard pattern. Document needs manual cross-check before approval.",
        severity: "LOW",
        alertCategory: "DOCUMENT_ERROR",
        subType: "MISSING_DOCUMENT",
        resolved: false,
        createdAt: daysAgo(1)
      }
    });
  }

  // 4. Resolved — for Resolution History tab
  if (donorIds[1]) {
    await prisma.fraudAlert.create({
      data: {
        type: "SUSPICIOUS_DONATION_FREQUENCY",
        entityId: donorIds[1],
        entityType: "DONOR",
        description: "Donor completed 8 successful donations in under 10 minutes — potential payment testing or card fraud.",
        severity: "MEDIUM",
        alertCategory: "FRAUD_ALERT",
        resolved: true,
        resolutionNote: "Verified with donor directly — bulk donations made during a fundraiser event. Confirmed not malicious. Account cleared.",
        createdAt: daysAgo(5)
      }
    });
  }

  console.log("  ✅ 3 fraud alerts created");

  // ── 7. Summary ────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅  Demo seed complete!\n");
  console.log("Admin login:");
  console.log("  Email:    admin@impactbridge.com");
  console.log("  Password: adminpassword123\n");
  console.log("Demo NGO logins (password: demoPassword123):");
  DEMO_NGOS.forEach(n => console.log(`  ${n.email}`));
  console.log("\nDemo donor logins (password: demoPassword123):");
  DEMO_DONORS.forEach(d => console.log(`  ${d.email}  [${d.donorCategory}${d.nriSourceDeclaration ? " / " + d.nriSourceDeclaration : ""}]`));
  console.log("\nWhat's seeded:");
  console.log("  • 7 verified NGOs with projects, milestones, proofs, and audit trail entries");
  console.log("    - Pragati Skills Institute: FCRA PENDING (in admin FCRA review queue)");
  console.log("    - Bal Sansar Foundation: FCRA NONE (domestic NGO demo)");
  console.log("  • 2 pending NGOs in admin verification queue (1 doc error, 1 likely fraud)");
  console.log("  • 6 donor accounts — 3 domestic, 1 NRI eligible, 1 NRI foreign-source, 1 foreign national");
  console.log("    sarah.foreign@demo.com  → FOREIGN_NATIONAL  — FCRA gate ALWAYS applies");
  console.log("    rajan.abroad@demo.com   → INDIAN_ABROAD/FOREIGN_SOURCE — FCRA gate applies");
  console.log("    amit.nri@demo.com       → INDIAN_ABROAD/ELIGIBLE_NRI_SOURCE — gate exempt");
  console.log("  • 4 fraud alerts — DOCUMENT_ERROR, FRAUD_ALERT, and resolved categories");
  console.log("  • Milestone audit trail (approved/rejected decisions with admin name + AI score)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
