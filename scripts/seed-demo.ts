import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

const DEMO_USERS = [
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
        target: 300000,
        raised: 200000,
        location: "Bangalore Rural",
        coverImage: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Government school students lack access to digital learning tools, widening the educational gap with private schools.",
        expectedOutcome: "Equip 5 schools with active digital projectors and tablets, leading to 25% higher student engagement in science & math."
      },
      {
        title: "Teacher Training Bootcamp",
        target: 200000,
        raised: 182000,
        location: "Bangalore Urban",
        coverImage: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Many rural teachers lack training in modern active-learning pedagogies, resulting in passive classroom environments.",
        expectedOutcome: "Train 50 rural school teachers who will implement active-learning strategies for over 2,000 primary school students."
      },
      {
        title: "Rural Literacy Kits",
        target: 150000,
        raised: 100000,
        location: "Mysore",
        coverImage: "",
        problemStatement: "Children in remote villages do not own age-appropriate reading books or basic worksheets at home.",
        expectedOutcome: "Distribute 500 literacy kits, improving basic reading competency scores among recipients by 30% in 6 months."
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
    description: "Provides free mobile health clinics and maternal care services to underserved rural communities in Maharashtra.",
    foundedYear: 2009,
    website: "https://jeevanhealth.org",
    cover_image_url: "https://images.unsplash.com/photo-1584515906207-52c616682b15?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Mobile Clinic Van",
        target: 500000,
        raised: 400000,
        location: "Pune District",
        coverImage: "https://images.unsplash.com/photo-1516550893923-42d28e5677af?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Villagers in remote Pune districts travel over 30km to access basic primary healthcare or checkups.",
        expectedOutcome: "Launch 1 fully-equipped mobile van providing regular weekly medical consultations to 10 village clusters."
      },
      {
        title: "Maternal Health Support",
        target: 400000,
        raised: 315500,
        location: "Satara Rural",
        coverImage: "",
        problemStatement: "High rates of home births and lack of prenatal checkups lead to high maternal and infant mortality rates.",
        expectedOutcome: "Provide prenatal screening and nutritional support kits to 150 pregnant women, encouraging safe institutional deliveries."
      },
      {
        title: "Mobile Health Camp for Rural Pune Villages",
        target: 85000,
        raised: 32000,
        location: "Pune, Maharashtra",
        coverImage: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Over 3,000 residents across 5 rural villages near Pune have no access to a functioning healthcare facility within 15 km, leading to delayed treatment for preventable illnesses and unmonitored maternal health risks.",
        expectedOutcome: "At least 800 individuals receive free health screenings and basic treatment, with high-risk maternal cases identified and referred to proper facilities.",
        milestones: [
          { title: "Camp Setup & Medicine Procurement", targetAmount: 30000, daysOffset: 30, status: "COMPLETED" },
          { title: "First Phase Deployments (3 Villages)", targetAmount: 30000, daysOffset: 60, status: "IN_PROGRESS" },
          { title: "Second Phase Deployments (2 Villages) & Reporting", targetAmount: 25000, daysOffset: 90, status: "PENDING" }
        ]
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
        target: 100000,
        raised: 80000,
        location: "Mussoorie Hills",
        coverImage: "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Deforestation in the Himalayan foothills has led to soil erosion, frequent landslides, and loss of local water springs.",
        expectedOutcome: "Plant 2,000 native tree saplings with local community caretaking, securing topsoil and restoring local habitats."
      },
      {
        title: "School Waste Audits",
        target: 100000,
        raised: 80000,
        location: "Dehradun Outskirts",
        coverImage: "",
        problemStatement: "Schools in Dehradun lack active recycling or waste segregation, producing massive plastic dump runoffs.",
        expectedOutcome: "Establish waste audit systems in 10 schools, redirecting 80% of dry waste away from landfills."
      },
      {
        title: "Riverbank Cleanup Campaigns",
        target: 100000,
        raised: 80000,
        location: "Haridwar",
        coverImage: "https://images.unsplash.com/photo-1618477388954-7852f32655ec?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Solid waste, plastics, and debris dumped along the Ganges riverbank pollute the water and harm aquatic life.",
        expectedOutcome: "Conduct 15 cleanup campaigns, removing 5 tons of plastic waste and installing public waste bins along the ghats."
      },
      {
        title: "Community Composting Bins",
        target: 100000,
        raised: 80000,
        location: "Rishikesh",
        coverImage: "",
        problemStatement: "Organic waste from household kitchens is thrown directly into common dump areas, generating methane emissions.",
        expectedOutcome: "Install 25 large-scale community composting bins, processing organic waste for 300 households into farming manure."
      },
      {
        title: "Reforestation Drive — 2,000 Native Saplings",
        target: 120000,
        raised: 45000,
        location: "Dehradun, Uttarakhand",
        coverImage: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Deforestation in the Himalayan foothills near Dehradun has led to soil erosion and declining local biodiversity, with degraded land currently unable to support native plant and animal life.",
        expectedOutcome: "2,000 saplings successfully planted and surviving past the first monsoon season, with measurable improvement in soil retention in the target area.",
        milestones: [
          { title: "Sapling Procurement & Land Prep", targetAmount: 40000, daysOffset: 30, status: "COMPLETED" },
          { title: "Planting Phase & Soil Inoculation", targetAmount: 40000, daysOffset: 60, status: "IN_PROGRESS" },
          { title: "Post-Monsoon Survival Audit", targetAmount: 40000, daysOffset: 120, status: "PENDING" }
        ]
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
        target: 500000,
        raised: 320000,
        location: "Jaipur Rural",
        coverImage: "https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Unemployed rural women lack marketable skills, leaving them financially dependent and vulnerable.",
        expectedOutcome: "Train 100 women in textile design and tailoring, enabling them to earn a sustainable monthly household income."
      },
      {
        title: "Micro-loans for Women Artisans",
        target: 500000,
        raised: 320000,
        location: "Jodhpur District",
        coverImage: "",
        problemStatement: "Traditional women craftmakers lack capital to buy raw materials or market their products, getting exploited by middlemen.",
        expectedOutcome: "Disburse interest-free micro-loans to 40 artisans, increasing their business profits by 40%."
      }
    ]
  },
  {
    email: "gramuday@demo.org",
    name: "GramUday President",
    orgName: "GramUday Initiative",
    registrationNumber: "REG-GRAMUDAY-56789",
    panNumber: "PANGRAM567",
    address: "Bhopal, Madhya Pradesh",
    causeCategories: ["Rural Development"],
    healthScore: null,
    description: "Builds rural infrastructure including clean water access points and solar electrification for remote villages.",
    foundedYear: 2018,
    website: null,
    cover_image_url: "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Solar Microgrid Installation",
        target: 1000000,
        raised: 0,
        location: "Bhopal Village",
        coverImage: "",
        problemStatement: "Frequent power cuts and lack of reliable grid electricity in Bhopal village limits children's study hours and clinic safety.",
        expectedOutcome: "Set up a community solar microgrid providing continuous electricity to 50 households and 1 local healthcare center."
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
    description: "Operates community kitchens and food distribution drives for daily-wage workers and homeless populations in urban Chennai.",
    foundedYear: 2014,
    website: "https://annaseva.org",
    cover_image_url: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=600&q=80",
    projects: [
      {
        title: "Daily Community Kitchen",
        target: 200000,
        raised: 100000,
        location: "Chennai Slums",
        coverImage: "https://images.unsplash.com/photo-1591389703635-e15a07b842d7?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Daily-wage construction workers and homeless seniors in Chennai go to bed hungry due to loss of livelihoods.",
        expectedOutcome: "Serve 500 hot, nutritious meals daily for 6 months, improving health and reducing malnutrition."
      },
      {
        title: "Migrant Worker Food Packs",
        target: 200000,
        raised: 100000,
        location: "Chennai Central",
        coverImage: "",
        problemStatement: "Migrant families facing sudden relocations struggle to secure dry rations or cooking resources.",
        expectedOutcome: "Distribute 300 dry ration packs containing rice, lentils, oil, and spices, sustaining families for 2 weeks."
      },
      {
        title: "Fisherfolk Breakfast Drive",
        target: 150000,
        raised: 95000,
        location: "Chennai Coastal",
        coverImage: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80",
        problemStatement: "Fishermen starting work at 3 AM often skip breakfast due to lack of open early eateries, affecting their health.",
        expectedOutcome: "Provide early-morning high-protein breakfasts to 250 fishermen daily, improving overall physical stamina."
      }
    ]
  }
];

async function main() {
  console.log("Seeding realistic demo NGO data...");

  const passwordHash = await bcrypt.hash("demoPassword123", 10);

  for (const demo of DEMO_USERS) {
    console.log(`Processing NGO: ${demo.orgName} (${demo.email})...`);

    // Clean up existing user/profile if it exists to make seed idempotent
    const existingUser = await prisma.user.findUnique({
      where: { email: demo.email }
    });

    if (existingUser) {
      const existingNGO = await prisma.nGOProfile.findUnique({
        where: { userId: existingUser.id }
      });
      if (existingNGO) {
        // Delete all projects & milestones first
        const projects = await prisma.project.findMany({
          where: { ngoId: existingNGO.id }
        });
        for (const p of projects) {
          await prisma.milestone.deleteMany({ where: { projectId: p.id } });
        }
        await prisma.project.deleteMany({ where: { ngoId: existingNGO.id } });
        await prisma.nGOFollower.deleteMany({ where: { ngoId: existingNGO.id } });
        await prisma.nGOProfile.delete({ where: { id: existingNGO.id } });
      }
      await prisma.user.delete({ where: { id: existingUser.id } });
    }

    // Create User
    const user = await prisma.user.create({
      data: {
        email: demo.email,
        name: demo.name,
        passwordHash,
        role: "NGO"
      }
    });

    // Create NGOProfile
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
        cover_image_url: demo.cover_image_url
      }
    });

    // Create Projects & Milestones
    for (const projectRaw of demo.projects) {
      const p = projectRaw as any;
      const project = await prisma.project.create({
        data: {
          ngoId: profile.id,
          title: p.title,
          description: `Help us fund: ${p.title}. Target amount: ₹${p.target.toLocaleString()}. Your donations go directly towards audited milestones.`,
          causeCategory: demo.causeCategories[0],
          targetAmount: p.target,
          raisedAmount: p.raised,
          status: "ACTIVE",
          coverImage: p.coverImage,
          location: p.location,
          problem_statement: p.problemStatement || null,
          expected_outcome: p.expectedOutcome || null
        }
      });

      // Seed milestones
      if (p.milestones && p.milestones.length > 0) {
        for (let i = 0; i < p.milestones.length; i++) {
          const m = p.milestones[i];
          await prisma.milestone.create({
            data: {
              projectId: project.id,
              title: m.title,
              description: `Deliverables and outcomes matching: ${m.title}`,
              targetAmount: m.targetAmount,
              deadline: new Date(Date.now() + m.daysOffset * 24 * 60 * 60 * 1000),
              status: m.status,
              sequenceOrder: i + 1
            }
          });
        }
      } else {
        // Seed a default milestone to ensure it works
        await prisma.milestone.create({
          data: {
            projectId: project.id,
            title: "Initial Execution Phase",
            description: "Initiate local activities, resource procurement, and setup verification.",
            targetAmount: p.target,
            deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
            status: "PENDING",
            sequenceOrder: 1
          }
        });
      }
    }
  }

  // Update existing Disha Education Trust profile to have a cover image
  console.log("Updating Disha Education Trust cover image...");
  await prisma.nGOProfile.updateMany({
    where: { orgName: "Disha Education Trust" },
    data: {
      cover_image_url: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=600&q=80"
    }
  });

  // Update existing Disha Education Trust project cover image to a plain photo without baked-in text
  console.log("Updating Textbooks & Learning Kits for Dharavi Children details...");
  await prisma.project.updateMany({
    where: { title: "Textbooks & Learning Kits for Dharavi Children" },
    data: {
      coverImage: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=600&q=80",
      problem_statement: "Primary school children in Dharavi slums lack basic textbooks, writing notebooks, and basic stationery, creating immediate barriers to school attendance, literacy, and active learning.",
      expected_outcome: "Equip 200 children with complete textbook, writing notebook, and stationery kits, leading to continuous school attendance and a 30% improvement in basic reading/writing assessments."
    }
  });

  console.log("Demo NGO seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
