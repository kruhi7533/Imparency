import { describe, it, expect } from "vitest";
import { makeTextPdf, makeBlankPdf } from "./helpers/make-pdf";
import { extractNgoFieldsByRules, classifyDocument } from "@/lib/ngo-rule-extraction";
import { extractPdfText, PdfTextError } from "@/lib/pdf-text";

const pdf = (lines: string[]) => ({ buffer: makeTextPdf(lines), mimeType: "application/pdf" });

const regCert = pdf([
  "Government of Telangana",
  "Certificate of Registration",
  "Registered under the Indian Trusts Act",
  "Name of the Trust: Jeevan Jyoti Rural Development Trust",
  "Registration No: TEST-TRUST-TG-2026-0042",
]);
const panCard = pdf(["Income Tax Department", "Permanent Account Number Card", "PAN: AAAAA0000A", "Jeevan Jyoti Rural Development Trust"]);
const cert80g = pdf(["Order under section 80G", "Name of the Trust: Jeevan Jyoti Rural Development Trust", "Unique Registration Number: AAAAA0000AF20261"]);

describe("extractPdfText", () => {
  it("reads the text layer of a real PDF", async () => {
    const { text } = await extractPdfText(makeTextPdf(["Hello ImpactBridge"]));
    expect(text).toContain("Hello ImpactBridge");
  });
  it("reports a scan with no text layer as PDF_NO_TEXT, not as empty success", async () => {
    await expect(extractPdfText(makeBlankPdf())).rejects.toMatchObject({ code: "PDF_NO_TEXT" });
  });
  it("reports garbage bytes as PDF_UNREADABLE", async () => {
    const err = await extractPdfText(Buffer.from("not a pdf")).catch((e) => e);
    expect(err).toBeInstanceOf(PdfTextError);
    expect(err.code).toBe("PDF_UNREADABLE");
  });
});

describe("classifyDocument", () => {
  it("recognises the common NGO documents", () => {
    expect(classifyDocument("Income Tax Department Permanent Account Number").docType).toBe("PAN_CARD");
    expect(classifyDocument("Certificate of Registration under the Societies Registration Act").docType).toBe("REGISTRATION_CERTIFICATE");
    expect(classifyDocument("Approval under section 80G").docType).toBe("TAX_EXEMPTION_80G");
    expect(classifyDocument("lorem ipsum").docType).toBe("UNKNOWN");
  });
});

describe("extractNgoFieldsByRules", () => {
  it("reads labelled values from the right documents", async () => {
    const r = await extractNgoFieldsByRules([regCert, panCard, cert80g]);
    const f = Object.fromEntries(r.fields.map((x) => [x.fieldKey, x]));
    expect(f.orgName.value).toBe("Jeevan Jyoti Rural Development Trust");
    expect(f.registrationNumber.value).toBe("TEST-TRUST-TG-2026-0042");
    expect(f.panNumber.value).toBe("AAAAA0000A");
    expect(f.panNumber.sourceDocumentIndex).toBe(1);
    expect(f.eightyGNumber.value).toBe("AAAAA0000AF20261");
    expect(f.orgName.confidence).toBeGreaterThanOrEqual(0.75);
    expect(r.documents.map((d) => d.docType)).toEqual(["REGISTRATION_CERTIFICATE", "PAN_CARD", "TAX_EXEMPTION_80G"]);
  });

  it("never invents a field that is not printed (12A absent → null, zero confidence)", async () => {
    const r = await extractNgoFieldsByRules([regCert, panCard, cert80g]);
    const a12 = r.fields.find((x) => x.fieldKey === "a12Number")!;
    expect(a12.value).toBeNull();
    expect(a12.confidence).toBe(0);
  });

  it("keeps each document's own organisation name so triage can compare them (D1 case)", async () => {
    const wrongCert = pdf(["Certificate of Registration", "Name of the Trust: Some Other Welfare Society", "Registration No: TEST-TRUST-TG-2026-0042"]);
    const r = await extractNgoFieldsByRules([wrongCert, panCard, cert80g]);
    expect(r.documents[0].orgNameOnDocument).toBe("Some Other Welfare Society");
    expect(r.documents[2].orgNameOnDocument).toBe("Jeevan Jyoti Rural Development Trust");
  });

  it("marks scans unreadable instead of guessing", async () => {
    const r = await extractNgoFieldsByRules([{ buffer: makeBlankPdf(), mimeType: "application/pdf" }]);
    expect(r.documents[0].readable).toBe(false);
    expect(r.fields.every((x) => x.value === null)).toBe(true);
  });
});
