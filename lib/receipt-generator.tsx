import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

export interface ReceiptData {
  // Donor
  donorName: string;
  donorPan: string;
  donorAddress: string;

  // NGO
  ngoName: string;
  ngoPan: string;
  ngoRegistrationNumber: string;
  ngo80GNumber: string;
  ngo80GValidityFrom: string;
  ngo80GValidityTo: string;
  ngoAddress: string;

  // Donation
  donationId: string;
  receiptNumber: string;
  amount: number;
  amountInWords: string;
  projectTitle: string;
  financialYear: string;
  donationDate: string;
  paymentMode: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111827",
    lineHeight: 1.5,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 5,
  },
  logoText: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#059669", // emerald-600
    letterSpacing: 1,
  },
  header: {
    alignItems: "center",
    marginBottom: 15,
  },
  title: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 10,
    textDecoration: "underline",
  },
  banner: {
    backgroundColor: "#F9FAFB",
    padding: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 12,
  },
  bannerText: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: "#059669",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  box: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    marginBottom: 3,
  },
  label: {
    width: "35%",
    fontFamily: "Helvetica-Bold",
    color: "#4B5563",
  },
  value: {
    width: "65%",
  },
  declaration: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Oblique",
    color: "#374151",
    marginTop: 8,
    marginBottom: 15,
    textAlign: "justify",
  },
  footer: {
    marginTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 8,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 5,
  },
  signatureContainer: {
    alignItems: "center",
    width: 150,
  },
  signatureSpace: {
    height: 30,
    borderBottomWidth: 1,
    borderBottomColor: "#9CA3AF",
    width: "100%",
    marginBottom: 4,
  },
  signText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  computerGenerated: {
    fontSize: 7.5,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 12,
  },
  verifiedBy: {
    fontSize: 8,
    color: "#059669",
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginTop: 3,
  }
});

const ReceiptDocument = ({ data }: { data: ReceiptData }) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Section 1: Logo & Header */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>IMPARENCY</Text>
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>
            DONATION RECEIPT UNDER SECTION 80G OF THE INCOME TAX ACT, 1961
          </Text>
        </View>

        {/* Banner with receipt details */}
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Receipt No: {data.receiptNumber}</Text>
          <Text style={styles.bannerText}>Date: {data.donationDate}</Text>
          <Text style={styles.bannerText}>Financial Year: {data.financialYear}</Text>
        </View>

        {/* Section 2: Donee Details */}
        <Text style={styles.sectionTitle}>Donee Organization Details</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>Name of Organization:</Text>
            <Text style={styles.value}>{data.ngoName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Registration Number:</Text>
            <Text style={styles.value}>{data.ngoRegistrationNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>PAN of Organization:</Text>
            <Text style={styles.value}>{data.ngoPan}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>80G Registration Number:</Text>
            <Text style={styles.value}>{data.ngo80GNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>80G Certificate Validity:</Text>
            <Text style={styles.value}>{data.ngo80GValidityFrom} to {data.ngo80GValidityTo}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Address:</Text>
            <Text style={styles.value}>{data.ngoAddress}</Text>
          </View>
        </View>

        {/* Section 3: Donor Details */}
        <Text style={styles.sectionTitle}>Donor Details</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>Name of Donor:</Text>
            <Text style={styles.value}>{data.donorName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>PAN of Donor:</Text>
            <Text style={styles.value}>{data.donorPan}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Address:</Text>
            <Text style={styles.value}>{data.donorAddress}</Text>
          </View>
        </View>

        {/* Section 4: Donation Details */}
        <Text style={styles.sectionTitle}>Donation Details</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>Amount in Figures:</Text>
            <Text style={styles.value}>Rs. {data.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Amount in Words:</Text>
            <Text style={styles.value}>{data.amountInWords}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Project / Purpose:</Text>
            <Text style={styles.value}>{data.projectTitle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Mode of Payment:</Text>
            <Text style={styles.value}>{data.paymentMode}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Transaction/Donation ID:</Text>
            <Text style={styles.value}>{data.donationId}</Text>
          </View>
        </View>

        {/* Section 5: Declaration */}
        <Text style={styles.declaration}>
          We hereby certify that the donation received is of an amount of Rs. {data.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Rupees {data.amountInWords}) from {data.donorName} and that this amount has been utilized / will be utilized for the purposes of the organization and NOT for any religious purpose. The deduction under Section 80G is available to the extent of 50% of the donation amount.
        </Text>

        {/* Section 6: Footer */}
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <View style={{ width: "60%" }}>
              <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>For {data.ngoName}</Text>
            </View>
            <View style={styles.signatureContainer}>
              <View style={styles.signatureSpace} />
              <Text style={styles.signText}>Authorized Signatory</Text>
            </View>
          </View>

          <Text style={styles.computerGenerated}>
            This is a computer-generated receipt and does not require a physical signature.
          </Text>
          <Text style={styles.verifiedBy}>
            Verified by Imparency Platform | www.imparency.in
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export async function generateTaxReceiptPDF(data: ReceiptData): Promise<Buffer> {
  return await renderToBuffer(<ReceiptDocument data={data} />);
}
