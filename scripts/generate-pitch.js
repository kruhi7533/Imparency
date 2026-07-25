const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

// 1. Parse payload if passed
let payload = {
  audience: 'indian',
  title: 'ImpactBridge: Transparent Giving Platform',
  description: 'A platform that connects donors with NGOs, offering real-time tracking of milestones and automated compliance verification.',
  causeCategory: 'GENERAL',
  targetAmount: '0'
};

if (process.argv[2]) {
  try {
    const raw = Buffer.from(process.argv[2], 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    payload = { ...payload, ...parsed };
  } catch (err) {
    console.error('[generate-pitch] Failed to parse payload argument:', err.message);
  }
}

// 2. Resolve output file path
const projectId = payload.projectId;
const audience = payload.audience;
const projSuffix = projectId ? `_${projectId}` : '';
const audSuffix = audience === 'foreign' ? '_foreign' : '_indian';
const fileName = `ImpactBridge_Pitch_Deck${projSuffix}${audSuffix}.pptx`;

const outputDir = path.join(process.cwd(), 'public', 'downloads');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const outputPath = path.join(outputDir, fileName);

// 3. Generate Presentation
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
pptx.title = payload.title;

// Design Colors
const COLOR_PRIMARY = '0D9488'; // Emerald 600
const COLOR_DARK = '1E293B';    // Slate 800
const COLOR_LIGHT = 'F8FAFC';   // Slate 50
const COLOR_ACCENT = 'F59E0B';  // Amber 500
const COLOR_MUTED = '64748B';   // Slate 500

// Slide 1: Title Slide
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_DARK };

  // Decorative Accent Rect
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 0.5, w: 0.1, h: 4.625,
    fill: { color: COLOR_PRIMARY }
  });

  // Title
  slide.addText(payload.title, {
    x: 1.0, y: 1.5, w: 8.0, h: 1.5,
    fontSize: 36, bold: true, color: 'FFFFFF',
    fontFace: 'Arial'
  });

  // Subtitle / Concept
  slide.addText("Donor Pitch & Impact Presentation", {
    x: 1.0, y: 3.0, w: 8.0, h: 0.5,
    fontSize: 18, color: COLOR_PRIMARY,
    fontFace: 'Arial'
  });

  // Footer / Context
  const audienceText = audience === 'foreign' ? 'Target: International / FCRA Compliance Focus' : 'Target: Domestic / 80G Tax-Benefit Focus';
  slide.addText(audienceText, {
    x: 1.0, y: 4.5, w: 8.0, h: 0.5,
    fontSize: 12, color: 'FFFFFF',
    fontFace: 'Arial'
  });
}

// Slide 2: The Core Problem
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_LIGHT };

  slide.addText("The Problem", {
    x: 0.5, y: 0.5, w: 9.0, h: 0.6,
    fontSize: 24, bold: true, color: COLOR_DARK,
    fontFace: 'Arial'
  });

  const points = [
    "Lack of Transparency: Donors rarely know how their funds are actually deployed.",
    "Milestone Disconnection: Traditional fundraising treats donation as a transaction, ignoring execution.",
    "Compliance Complexity: Severe regulatory scrutiny on NGO compliance (FCRA, 80G, 12A, CSR reporting)."
  ];

  points.forEach((point, i) => {
    slide.addText(point, {
      x: 0.8, y: 1.5 + i * 1.2, w: 8.4, h: 0.8,
      fontSize: 15, color: COLOR_MUTED,
      fontFace: 'Arial',
      bullet: { code: '25BA' }
    });
  });
}

// Slide 3: The Solution
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_LIGHT };

  slide.addText("The Solution", {
    x: 0.5, y: 0.5, w: 9.0, h: 0.6,
    fontSize: 24, bold: true, color: COLOR_PRIMARY,
    fontFace: 'Arial'
  });

  const solutions = [
    { title: "Real-Time Milestone Tracking", desc: "Donations are earmarked to specific campaign milestones. Funds are deployed in stages with photo/document proofs verified by AI and admins." },
    { title: "Automated Compliance Gate", desc: "Automated verification of 80G/12A certificates and strict FCRA routing for foreign or NRI donations." },
    { title: "Donor Engagement Loop", desc: "Interactive donor dashboard showing personalized impact summaries, push alerts, and direct project engagement." }
  ];

  solutions.forEach((sol, i) => {
    slide.addText(sol.title, {
      x: 0.8, y: 1.3 + i * 1.3, w: 8.4, h: 0.4,
      fontSize: 16, bold: true, color: COLOR_DARK,
      fontFace: 'Arial'
    });
    slide.addText(sol.desc, {
      x: 0.8, y: 1.7 + i * 1.3, w: 8.4, h: 0.6,
      fontSize: 13, color: COLOR_MUTED,
      fontFace: 'Arial'
    });
  });
}

// Slide 4: Project/NGO Overview Focus
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_LIGHT };

  slide.addText("Campaign Focus", {
    x: 0.5, y: 0.5, w: 9.0, h: 0.6,
    fontSize: 24, bold: true, color: COLOR_DARK,
    fontFace: 'Arial'
  });

  slide.addText("Current Project Details:", {
    x: 0.8, y: 1.2, w: 8.4, h: 0.4,
    fontSize: 16, bold: true, color: COLOR_PRIMARY,
    fontFace: 'Arial'
  });

  // Title & description of campaign
  slide.addText(`Campaign: ${payload.title}`, {
    x: 0.8, y: 1.7, w: 8.4, h: 0.5,
    fontSize: 15, bold: true, color: COLOR_DARK,
    fontFace: 'Arial'
  });

  slide.addText(payload.description || 'General fundraising and community outreach initiative by ImpactBridge verified NGOs.', {
    x: 0.8, y: 2.2, w: 8.4, h: 1.2,
    fontSize: 13, color: COLOR_MUTED,
    fontFace: 'Arial'
  });

  // Cause category and target amount
  const categoryStr = payload.causeCategory ? `Category: ${payload.causeCategory}` : 'Category: Social Impact';
  const targetStr = payload.targetAmount && payload.targetAmount !== '0' ? `Funding Ask: INR ${Number(payload.targetAmount).toLocaleString()}` : 'Funding Ask: Custom donation matching';
  
  slide.addText(categoryStr, {
    x: 0.8, y: 3.6, w: 4.0, h: 0.4,
    fontSize: 13, bold: true, color: COLOR_PRIMARY,
    fontFace: 'Arial'
  });

  slide.addText(targetStr, {
    x: 4.8, y: 3.6, w: 4.4, h: 0.4,
    fontSize: 13, bold: true, color: COLOR_ACCENT,
    fontFace: 'Arial'
  });
}

// Slide 5: Compliance and Segregation
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_LIGHT };

  slide.addText("Compliance & Governance Infrastructure", {
    x: 0.5, y: 0.5, w: 9.0, h: 0.6,
    fontSize: 24, bold: true, color: COLOR_DARK,
    fontFace: 'Arial'
  });

  const fcraPoints = [
    "FCRA Gatekeeping: Ensures all foreign contributions flow exclusively to FCRA-registered and verified NGOs. Non-compliant transactions are automatically rejected.",
    "Donor Category Attestation: Strict segregation of Indian domestic donors, NRI (eligible source) accounts, and Foreign Nationals.",
    "Section 80G Tax Deductions: Automated 80G tax receipt generation for all eligible Indian domestic contributions."
  ];

  fcraPoints.forEach((point, i) => {
    slide.addText(point, {
      x: 0.8, y: 1.5 + i * 1.2, w: 8.4, h: 0.8,
      fontSize: 14, color: COLOR_MUTED,
      fontFace: 'Arial',
      bullet: { code: '2713' }
    });
  });
}

// Slide 6: Call to Action
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_DARK };

  slide.addText("Connect with ImpactBridge", {
    x: 1.0, y: 1.5, w: 8.0, h: 1.0,
    fontSize: 32, bold: true, color: 'FFFFFF',
    align: 'center',
    fontFace: 'Arial'
  });

  slide.addText("Transparency creates trust. Trust drives impact.", {
    x: 1.0, y: 2.5, w: 8.0, h: 0.6,
    fontSize: 16, color: COLOR_PRIMARY,
    align: 'center',
    fontFace: 'Arial'
  });

  slide.addText("For inquiries, contact us at partnerships@impactbridge.com or visit www.impactbridge.com", {
    x: 1.0, y: 3.5, w: 8.0, h: 0.8,
    fontSize: 13, color: 'FFFFFF',
    align: 'center',
    fontFace: 'Arial'
  });
}

// 4. Save file
pptx.writeFile({ fileName: outputPath })
  .then(() => {
    console.log(`[generate-pitch] Successfully created pitch deck at: ${outputPath}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[generate-pitch] Failed to write PPTX file:', err.message);
    process.exit(1);
  });
