import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import { amountToWords } from "./finance-utils";

// Create styles for PDF
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1f2937", // gray-800
    lineHeight: 1.5,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: "#059669", // emerald-600
    paddingBottom: 15,
    marginBottom: 20,
  },
  logoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#059669",
  },
  receiptTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#374151", // gray-700
  },
  receiptMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
    fontSize: 9,
    color: "#6b7280", // gray-500
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#374151",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb", // gray-200
    paddingBottom: 3,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  gridTwoCol: {
    flexDirection: "row",
    gap: 20,
    marginBottom: 10,
  },
  col: {
    flex: 1,
  },
  label: {
    fontSize: 8,
    color: "#6b7280",
    fontWeight: "bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: {
    fontSize: 10,
    color: "#1f2937",
  },
  amountBox: {
    backgroundColor: "#f0fdf4", // emerald-50
    borderWidth: 1,
    borderColor: "#bbf7d0", // emerald-200
    borderRadius: 6,
    padding: 12,
    marginVertical: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  amountTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#065f46", // emerald-800
  },
  amountInWords: {
    fontSize: 9,
    fontStyle: "italic",
    color: "#047857", // emerald-700
    marginTop: 4,
  },
  declaration: {
    fontSize: 9,
    color: "#4b5563", // gray-600
    backgroundColor: "#f9fafb", // gray-50
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 10,
    marginVertical: 15,
    fontStyle: "italic",
    textAlign: "center",
  },
  signatoryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
    paddingTop: 10,
  },
  signatoryBox: {
    width: 150,
    borderTopWidth: 1,
    borderTopColor: "#9ca3af", // gray-400
    paddingTop: 5,
    alignItems: "center",
  },
  signatoryText: {
    fontSize: 9,
    color: "#4b5563",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
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

interface ReceiptProps {
  donation: {
    id: string;
    amount: number;
    createdAt: Date;
    razorpayPaymentId: string | null;
  };
  taxReceipt: {
    receiptNumber: string;
    financialYear: string;
    issuedAt: Date;
  };
  donor: {
    name: string;
    panNumber: string | null;
    billingAddress: string | null;
  };
  ngo: {
    orgName: string;
    registrationNumber: string;
    panNumber: string; // NGO PAN
    adminNote?: string | null; // We can use it or fallback, wait, NGO profile has PAN
  };
  project: {
    title: string;
  };
}

export const ReceiptDocument: React.FC<ReceiptProps> = ({
  donation,
  taxReceipt,
  donor,
  ngo,
  project,
}) => {
  const amountVal = Number(donation.amount);
  const words = amountToWords(amountVal);
  const issueDateStr = new Date(taxReceipt.issuedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header Banner */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Text style={styles.brandName}>ImpactBridge</Text>
            <Text style={styles.receiptTitle}>Official Tax Exemption Receipt</Text>
          </View>
          <View style={styles.receiptMetaRow}>
            <Text>Receipt No: {taxReceipt.receiptNumber}</Text>
            <Text>Financial Year: {taxReceipt.financialYear}</Text>
            <Text>Issued Date: {issueDateStr}</Text>
          </View>
        </View>

        {/* Section 1: NGO Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recipient (NGO Details)</Text>
          <View style={styles.gridTwoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Organization Name</Text>
              <Text style={styles.value}>{ngo.orgName}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>NGO PAN Number</Text>
              <Text style={styles.value}>{ngo.panNumber}</Text>
            </View>
          </View>
          <View style={styles.gridTwoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Registration Number</Text>
              <Text style={styles.value}>{ngo.registrationNumber}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>80G Order Number</Text>
              <Text style={styles.value}>80G Certificate: CIT(E)/80G/EXEMPT/MOCK-0012</Text>
            </View>
          </View>
        </View>

        {/* Section 2: Donor Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Donor Details</Text>
          <View style={styles.gridTwoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Donor Full Name</Text>
              <Text style={styles.value}>{donor.name}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Donor PAN Number</Text>
              <Text style={styles.value}>{donor.panNumber || "N/A"}</Text>
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>Billing Address</Text>
            <Text style={styles.value}>{donor.billingAddress || "N/A"}</Text>
          </View>
        </View>

        {/* Section 3: Donation Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contribution Summary</Text>
          <View style={styles.gridTwoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Allocated Project</Text>
              <Text style={styles.value}>{project.title}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Razorpay Payment ID</Text>
              <Text style={styles.value}>{donation.razorpayPaymentId || "N/A"}</Text>
            </View>
          </View>

          {/* Amount Box */}
          <View style={styles.amountBox}>
            <View>
              <Text style={styles.label}>Contribution Amount</Text>
              <Text style={styles.amountTitle}>₹{amountVal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
            </View>
            <View style={{ alignItems: "flex-end", flex: 1, marginLeft: 20 }}>
              <Text style={styles.label}>Amount in Words</Text>
              <Text style={styles.amountInWords}>{words}</Text>
            </View>
          </View>
        </View>

        {/* Declaration Box */}
        <View style={styles.declaration}>
          <Text>
            "This donation is eligible for tax deduction under Section 80G of the Income Tax Act, 1961. 
            No benefit, direct or indirect, has been or will be provided to the donor in return for this contribution."
          </Text>
        </View>

        {/* Signatory line */}
        <View style={styles.signatoryRow}>
          <View style={{ flex: 1 }}></View>
          <View style={styles.signatoryBox}>
            <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 2 }}>{ngo.orgName}</Text>
            <Text style={styles.signatoryText}>Authorized Signatory</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            This is a computer-generated receipt and does not require a physical signature.
          </Text>
          <Text style={[styles.footerText, { marginTop: 2 }]}>
            ImpactBridge Transparency Portal | Powered by Gemini Validation Engines
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export async function generateReceiptBuffer(
  donation: any,
  taxReceipt: any,
  donor: any,
  ngo: any,
  project: any
): Promise<Buffer> {
  const doc = (
    <ReceiptDocument
      donation={donation}
      taxReceipt={taxReceipt}
      donor={donor}
      ngo={ngo}
      project={project}
    />
  );
  return (await pdf(doc).toBuffer()) as any as Buffer;
}
