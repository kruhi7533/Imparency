import React from "react";
import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { getIndianFinancialYear } from "@/lib/finance-utils";

export const runtime = "nodejs";

// Styles for the Utilization Certificate
const styles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1f2937",
    lineHeight: 1.6,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#059669", // emerald-600
    paddingBottom: 15,
    marginBottom: 25,
    alignItems: "center",
  },
  brandName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#059669",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  receiptTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#4b5563",
    marginTop: 5,
  },
  metaTable: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 12,
    backgroundColor: "#f9fafb",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    fontWeight: "bold",
    color: "#6b7280",
    fontSize: 9,
  },
  value: {
    color: "#1f2937",
    fontWeight: "bold",
  },
  table: {
    marginVertical: 15,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  thNgo: { flex: 2, fontSize: 8, color: "#4b5563" },
  thProject: { flex: 2, fontSize: 8, color: "#4b5563" },
  thAmount: { flex: 1.2, fontSize: 8, color: "#4b5563", textAlign: "right" },
  thMilestones: { flex: 1.2, fontSize: 8, color: "#4b5563", textAlign: "center" },
  thScore: { flex: 1, fontSize: 8, color: "#4b5563", textAlign: "right" },
  tdNgo: { flex: 2, fontSize: 9 },
  tdProject: { flex: 2, fontSize: 9 },
  tdAmount: { flex: 1.2, fontSize: 9, textAlign: "right", fontWeight: "bold" },
  tdMilestones: { flex: 1.2, fontSize: 9, textAlign: "center" },
  tdScore: { flex: 1, fontSize: 9, textAlign: "right" },
  declaration: {
    marginTop: 25,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 6,
    padding: 12,
    textAlign: "center",
    fontStyle: "italic",
    fontSize: 9.5,
    color: "#065f46",
  },
  signatoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 50,
  },
  signatoryBox: {
    width: 180,
    borderTopWidth: 1,
    borderTopColor: "#9ca3af",
    paddingTop: 6,
    alignItems: "center",
  },
  footer: {
    position: "absolute",
    bottom: 40,
    left: 50,
    right: 50,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
    alignItems: "center",
  },
  footerText: {
    fontSize: 8,
    color: "#9ca3af",
  },
});

interface CertificateProps {
  companyName: string;
  gstNumber: string | null;
  financialYear: string;
  totalCSRSpend: number;
  projects: {
    ngoName: string;
    projectTitle: string;
    amountDonated: number;
    milestonesCompleted: number;
    averageAiScore: number | null;
  }[];
  date: string;
  certificateNumber: string;
}

const CertificateDocument: React.FC<CertificateProps> = ({
  companyName,
  gstNumber,
  financialYear,
  totalCSRSpend,
  projects,
  date,
  certificateNumber,
}) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Letterhead Header */}
      <View style={styles.header}>
        <Text style={styles.brandName}>ImpactBridge</Text>
        <Text style={styles.receiptTitle}>Annual CSR Utilization Certificate</Text>
      </View>

      {/* Corporate details */}
      <View style={styles.metaTable}>
        <View style={styles.metaRow}>
          <Text style={styles.label}>Corporate Entity</Text>
          <Text style={styles.value}>{companyName}</Text>
        </View>
        {gstNumber && (
          <View style={styles.metaRow}>
            <Text style={styles.label}>GSTIN</Text>
            <Text style={styles.value}>{gstNumber}</Text>
          </View>
        )}
        <View style={styles.metaRow}>
          <Text style={styles.label}>Financial Year</Text>
          <Text style={styles.value}>{financialYear}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.label}>Certificate Number</Text>
          <Text style={styles.value}>{certificateNumber}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.label}>Date of Generation</Text>
          <Text style={styles.value}>{date}</Text>
        </View>
        <View style={[styles.metaRow, { borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 6, marginTop: 4 }]}>
          <Text style={[styles.label, { color: "#065f46" }]}>Total CSR Utilization</Text>
          <Text style={[styles.value, { color: "#059669", fontSize: 11 }]}>
            ₹{totalCSRSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </View>

      {/* Utilization breakdown table */}
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={styles.thNgo}>NGO Partner</Text>
          <Text style={styles.thProject}>Supported Project</Text>
          <Text style={styles.thAmount}>Amount</Text>
          <Text style={styles.thMilestones}>Milestones</Text>
          <Text style={styles.thScore}>AI Score</Text>
        </View>
        
        {projects.map((p, idx) => (
          <View key={idx} style={styles.tableRow}>
            <Text style={styles.tdNgo}>{p.ngoName}</Text>
            <Text style={styles.tdProject}>{p.projectTitle}</Text>
            <Text style={styles.tdAmount}>₹{p.amountDonated.toLocaleString("en-IN")}</Text>
            <Text style={styles.tdMilestones}>{p.milestonesCompleted} Comp</Text>
            <Text style={styles.tdScore}>
              {p.averageAiScore !== null ? `${p.averageAiScore}/100` : "N/A"}
            </Text>
          </View>
        ))}
      </View>

      {/* Declaration box */}
      <View style={styles.declaration}>
        <Text>
          "The above contributions were made to verified NGOs on the ImpactBridge platform. 
          Milestone completion and fund utilization have been independently validated through our 
          Gemini AI audit engine and administrative reviews."
        </Text>
      </View>

      {/* Signatories */}
      <View style={styles.signatoryRow}>
        <View style={styles.signatoryBox}>
          <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 2 }}>{companyName}</Text>
          <Text style={{ fontSize: 8, color: "#6b7280" }}>Corporate CSR Head</Text>
        </View>
        <View style={styles.signatoryBox}>
          <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 2 }}>ImpactBridge Compliance</Text>
          <Text style={{ fontSize: 8, color: "#6b7280" }}>Authorized Verifier</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          This is a system-generated compliance utilization certificate. Verification hashes can be tracked on-chain.
        </Text>
        <Text style={[styles.footerText, { marginTop: 2 }]}>
          ImpactBridge Compliance | Transparency in Philanthropy
        </Text>
      </View>
    </Page>
  </Document>
);

export async function GET(request: Request) {
  // 1. Authenticate user
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) {
    return auth.response;
  }

  const userId = auth.session.user.id;

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get("fy");

    if (!fy) {
      return NextResponse.json({ error: "Financial year parameter 'fy' is required" }, { status: 400 });
    }

    // 2. Fetch corporate user
    const donor = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!donor || !donor.isCorporate) {
      return NextResponse.json({ error: "Only registered corporate accounts can generate certificates" }, { status: 403 });
    }

    // 3. Fetch all successful donations
    const donations = await prisma.donation.findMany({
      where: {
        donorId: userId,
        status: "SUCCESS"
      },
      include: {
        project: {
          include: {
            ngo: true
          }
        }
      }
    });

    // 4. Filter by financial year in code using the helper
    const fyDonations = donations.filter((d) => getIndianFinancialYear(d.createdAt) === fy);

    if (fyDonations.length === 0) {
      return NextResponse.json({ error: `No donations found for Financial Year ${fy}` }, { status: 404 });
    }

    const totalCSRSpend = fyDonations.reduce((sum, d) => sum + Number(d.amount), 0);

    // 5. Aggregate project compliance details
    const projectMap = new Map<string, {
      ngoName: string;
      projectTitle: string;
      amountDonated: number;
      milestonesCompleted: number;
      aiScores: number[];
    }>();

    for (const d of fyDonations) {
      const pId = d.projectId;
      const amount = Number(d.amount);

      if (!projectMap.has(pId)) {
        // Fetch project milestones
        const projectWithMilestones = await prisma.project.findUnique({
          where: { id: pId },
          include: {
            ngo: true,
            milestones: {
              include: {
                proofs: {
                  orderBy: { submittedAt: "desc" },
                  take: 1
                }
              }
            }
          }
        });

        if (projectWithMilestones) {
          const milestones = projectWithMilestones.milestones;
          const completed = milestones.filter(m => m.status === "COMPLETED" || m.status === "VERIFIED");
          const scores: number[] = [];
          completed.forEach((m) => {
            const latestProof = m.proofs[0];
            if (latestProof && latestProof.aiValidationScore !== null) {
              scores.push(latestProof.aiValidationScore);
            }
          });

          projectMap.set(pId, {
            ngoName: projectWithMilestones.ngo.orgName,
            projectTitle: projectWithMilestones.title,
            amountDonated: amount,
            milestonesCompleted: completed.length,
            aiScores: scores
          });
        }
      } else {
        const item = projectMap.get(pId)!;
        item.amountDonated += amount;
      }
    }

    const projectsList = Array.from(projectMap.values()).map((item) => {
      const avgScore = item.aiScores.length > 0
        ? Math.round(item.aiScores.reduce((a, b) => a + b, 0) / item.aiScores.length)
        : null;
      return {
        ngoName: item.ngoName,
        projectTitle: item.projectTitle,
        amountDonated: item.amountDonated,
        milestonesCompleted: item.milestonesCompleted,
        averageAiScore: avgScore
      };
    });

    // Generate unique Certificate Number
    const shortYear = fy.split("-")[1] || "26";
    const certificateNumber = `IB-UC-FY${shortYear}-${donor.id.substring(0, 8).toUpperCase()}`;

    // Render PDF Document
    const doc = (
      <CertificateDocument
        companyName={donor.companyName || donor.name}
        gstNumber={donor.gstNumber}
        financialYear={fy}
        totalCSRSpend={totalCSRSpend}
        projects={projectsList}
        date={new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        certificateNumber={certificateNumber}
      />
    );

    const pdfBuffer = await pdf(doc).toBuffer();

    return new Response(pdfBuffer as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="CSR_Utilization_Certificate_${fy}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error("Utilization certificate generation error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
