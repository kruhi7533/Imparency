import { describe, it, expect } from "vitest";
import {
  CIN_PATTERN,
  assessFunderOrg,
  decideOrgStatus,
  identityChanged,
  isFunderPersona,
  isValidCin,
  normalizeCin,
  orgKindFor,
  type FunderOrgInput,
} from "@/lib/csr-verification";

/** Suryodaya Industries Limited — the acceptance pack's CSR donor. */
const COMPANY: FunderOrgInput = {
  donorPersona: "CSR_OFFICER",
  orgName: "Suryodaya Industries Limited",
  cin: "U99999TG2026PLC000001",
  csrBudget: 5000000,
  trustRegistrationId: null,
  trustAnnualBudget: null,
};

/** A foundation — no CIN exists for a trust, which is the whole point. */
const TRUST: FunderOrgInput = {
  donorPersona: "FOUNDATION",
  orgName: "Vaibhavi Charitable Foundation",
  cin: null,
  csrBudget: null,
  trustRegistrationId: "TRUST-TEST-2026-001",
  trustAnnualBudget: 2000000,
};

const GOVT: FunderOrgInput = {
  donorPersona: "GOVERNMENT",
  orgName: "Department of Rural Development, Telangana",
  cin: null,
  csrBudget: null,
  trustRegistrationId: null,
  trustAnnualBudget: null,
};

describe("CIN validation", () => {
  it("accepts the acceptance-pack CIN", () => {
    expect(isValidCin("U99999TG2026PLC000001")).toBe(true);
    expect(CIN_PATTERN.test("U99999TG2026PLC000001")).toBe(true);
  });

  it("accepts a listed-company CIN", () => {
    expect(isValidCin("L17110MH1973PLC019786")).toBe(true);
  });

  it("normalises spacing and case before judging", () => {
    expect(normalizeCin(" u99999tg2026plc000001 ")).toBe("U99999TG2026PLC000001");
    expect(isValidCin("u99999 tg2026-plc000001")).toBe(true);
  });

  it("rejects a CIN of the wrong length", () => {
    expect(isValidCin("U99999TG2026PLC00001")).toBe(false); // 20 chars
    expect(isValidCin("U99999TG2026PLC0000011")).toBe(false); // 22 chars
  });

  it("rejects trailing rubbish rather than partially matching", () => {
    expect(isValidCin("U99999TG2026PLC000001; DROP TABLE")).toBe(false);
  });

  it("rejects a first character that is neither L nor U", () => {
    expect(isValidCin("X99999TG2026PLC000001")).toBe(false);
  });

  it("treats absent and empty as invalid without throwing", () => {
    expect(isValidCin(null)).toBe(false);
    expect(isValidCin(undefined)).toBe(false);
    expect(isValidCin("   ")).toBe(false);
    expect(normalizeCin(null)).toBeNull();
  });
});

describe("orgKindFor / isFunderPersona", () => {
  it("maps each funding persona to the evidence it can actually produce", () => {
    expect(orgKindFor("CSR_OFFICER")).toBe("COMPANY");
    expect(orgKindFor("FOUNDATION")).toBe("TRUST");
    expect(orgKindFor("GOVERNMENT")).toBe("GOVERNMENT");
  });

  it("treats individual and HNI donors as no organisation at all", () => {
    expect(orgKindFor("INDIVIDUAL")).toBe("NONE");
    expect(orgKindFor("HNI")).toBe("NONE");
    expect(orgKindFor(null)).toBe("NONE");
    expect(isFunderPersona("INDIVIDUAL")).toBe(false);
    expect(isFunderPersona("CSR_OFFICER")).toBe(true);
  });
});

describe("assessFunderOrg — a company", () => {
  it("passes the golden-path corporate profile", () => {
    const r = assessFunderOrg(COMPANY);
    expect(r.kind).toBe("COMPANY");
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("reports every missing field at once rather than one at a time", () => {
    const r = assessFunderOrg({ ...COMPANY, orgName: null, cin: null, csrBudget: null });
    expect(r.complete).toBe(false);
    expect(r.missing).toHaveLength(3);
  });

  it("distinguishes a malformed CIN from an absent one", () => {
    const absent = assessFunderOrg({ ...COMPANY, cin: null });
    const malformed = assessFunderOrg({ ...COMPANY, cin: "NOTACIN" });
    expect(absent.missing).toContain("CIN");
    expect(malformed.missing.join(" ")).toContain("valid CIN");
    expect(absent.missing).not.toEqual(malformed.missing);
  });

  it("does not accept a zero or negative CSR budget as present", () => {
    expect(assessFunderOrg({ ...COMPANY, csrBudget: 0 }).complete).toBe(false);
    expect(assessFunderOrg({ ...COMPANY, csrBudget: -1 }).complete).toBe(false);
  });

  it("accepts a Decimal-style string budget, since Prisma hands one back", () => {
    expect(assessFunderOrg({ ...COMPANY, csrBudget: "5000000" }).complete).toBe(true);
  });

  it("does not treat a whitespace-only name as present", () => {
    expect(assessFunderOrg({ ...COMPANY, orgName: "   " }).complete).toBe(false);
  });

  it("never asks a company for trust evidence", () => {
    expect(assessFunderOrg(COMPANY).missing).not.toContain("trust registration number");
  });
});

describe("assessFunderOrg — a trust", () => {
  it("passes a foundation with a registration number and a budget", () => {
    const r = assessFunderOrg(TRUST);
    expect(r.kind).toBe("TRUST");
    expect(r.complete).toBe(true);
  });

  it("NEVER demands a CIN of a trust — a trust does not have one", () => {
    // The regression that matters: requiring a CIN here would lock every
    // foundation out of funding permanently.
    expect(assessFunderOrg(TRUST).missing).not.toContain("CIN");
    expect(assessFunderOrg({ ...TRUST, cin: null }).complete).toBe(true);
  });

  it("requires the trust registration number", () => {
    const r = assessFunderOrg({ ...TRUST, trustRegistrationId: null });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("trust registration number");
  });

  it("requires an annual grant budget", () => {
    expect(assessFunderOrg({ ...TRUST, trustAnnualBudget: null }).complete).toBe(false);
  });
});

describe("assessFunderOrg — a government body", () => {
  it("asks only for a name, because no registry exists to check against", () => {
    const r = assessFunderOrg(GOVT);
    expect(r.kind).toBe("GOVERNMENT");
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("still requires the name", () => {
    expect(assessFunderOrg({ ...GOVT, orgName: null }).complete).toBe(false);
  });
});

describe("assessFunderOrg — not an institution", () => {
  it("refuses an individual donor — there is no organisation to verify", () => {
    const r = assessFunderOrg({ ...COMPANY, donorPersona: "INDIVIDUAL" });
    expect(r.kind).toBe("NONE");
    expect(r.complete).toBe(false);
  });

  it("refuses a donor with no persona set", () => {
    expect(assessFunderOrg({ ...COMPANY, donorPersona: null }).complete).toBe(false);
  });
});

describe("identityChanged", () => {
  const before = {
    orgName: "Suryodaya Industries Limited",
    cin: "U99999TG2026PLC000001",
    trustRegistrationId: null,
  };

  it("ignores casing and surrounding whitespace", () => {
    expect(
      identityChanged(before, {
        orgName: "  suryodaya industries limited ",
        cin: "u99999tg2026plc000001",
        trustRegistrationId: null,
      })
    ).toBe(false);
  });

  it("catches a renamed organisation", () => {
    expect(identityChanged(before, { ...before, orgName: "Some Other Industries Limited" })).toBe(true);
  });

  it("catches a swapped CIN", () => {
    expect(identityChanged(before, { ...before, cin: "U11111TG2026PLC000002" })).toBe(true);
  });

  it("catches a swapped trust registration number", () => {
    const trustBefore = { orgName: "A Foundation", cin: null, trustRegistrationId: "T-1" };
    expect(identityChanged(trustBefore, { ...trustBefore, trustRegistrationId: "T-2" })).toBe(true);
  });
});

describe("decideOrgStatus — a donor editing their own profile", () => {
  const before = {
    orgName: COMPANY.orgName,
    cin: COMPANY.cin,
    trustRegistrationId: null,
  };

  it("moves a newly completed corporate profile into the queue", () => {
    const d = decideOrgStatus("NOT_SUBMITTED", { orgName: null, cin: null, trustRegistrationId: null }, COMPANY);
    expect(d).toEqual({ status: "PENDING", submitted: true, reopened: false });
  });

  it("moves a newly completed foundation into the queue too", () => {
    const d = decideOrgStatus("NOT_SUBMITTED", { orgName: null, cin: null, trustRegistrationId: null }, TRUST);
    expect(d.status).toBe("PENDING");
    expect(d.submitted).toBe(true);
  });

  it("leaves an incomplete profile out of the queue", () => {
    const d = decideOrgStatus("NOT_SUBMITTED", { orgName: null, cin: null, trustRegistrationId: null }, {
      ...COMPANY,
      cin: null,
    });
    expect(d.status).toBe("NOT_SUBMITTED");
    expect(d.submitted).toBe(false);
  });

  it("CANNOT grant an approval — no path returns VERIFIED from an unverified state", () => {
    for (const current of ["NOT_SUBMITTED", "PENDING", "REJECTED"] as const) {
      for (const input of [COMPANY, TRUST, GOVT]) {
        expect(decideOrgStatus(current, before, input).status).not.toBe("VERIFIED");
      }
    }
  });

  it("retires an approval when the organisation renames itself", () => {
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, orgName: "Different Industries Limited" });
    expect(d).toEqual({ status: "PENDING", submitted: false, reopened: true });
  });

  it("retires an approval when the CIN changes", () => {
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, cin: "U11111TG2026PLC000002" });
    expect(d.reopened).toBe(true);
    expect(d.status).toBe("PENDING");
  });

  it("leaves an approval alone for an ordinary budget update", () => {
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, csrBudget: 9000000 });
    expect(d).toEqual({ status: "VERIFIED", submitted: false, reopened: false });
  });

  it("returns a rejected donor to the queue once they complete the profile", () => {
    const d = decideOrgStatus("REJECTED", { orgName: COMPANY.orgName, cin: null, trustRegistrationId: null }, COMPANY);
    expect(d.status).toBe("PENDING");
    expect(d.submitted).toBe(true);
  });

  it("keeps a rejection standing while the profile is still incomplete", () => {
    const d = decideOrgStatus("REJECTED", before, { ...COMPANY, cin: null });
    expect(d.status).toBe("REJECTED");
  });

  it("drops a pending profile out of the queue if an edit breaks it", () => {
    const d = decideOrgStatus("PENDING", before, { ...COMPANY, csrBudget: null });
    expect(d.status).toBe("NOT_SUBMITTED");
  });

  it("retires everything when the donor stops being an institution", () => {
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, donorPersona: "INDIVIDUAL" });
    expect(d.status).toBe("NOT_SUBMITTED");
    expect(d.reopened).toBe(true);
  });

  it("does not re-fire a submission event on a no-op save of a pending profile", () => {
    expect(decideOrgStatus("PENDING", before, COMPANY).submitted).toBe(false);
  });
});

/**
 * The profile-save regression this guards.
 *
 * The CIN was added to the schema, the API and the admin review gate before it
 * existed as a field on the donor's own profile form. So a CSR donor could
 * never supply one — and worse, saving the form sent no `cin` key at all, which
 * nulled the column and silently dropped the company out of the review queue.
 * These pin the two halves of that fix.
 */
describe("decideOrgStatus — CIN preserved across an unrelated save", () => {
  const before = { orgName: COMPANY.orgName, cin: COMPANY.cin, trustRegistrationId: null };

  it("stays PENDING when the save carries the CIN forward unchanged", () => {
    // What the route now does when `cin` is absent: substitute the stored one.
    const d = decideOrgStatus("PENDING", before, { ...COMPANY, cin: before.cin });
    expect(d.status).toBe("PENDING");
  });

  it("stays VERIFIED, and does NOT reopen, when the CIN is carried forward", () => {
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, cin: before.cin });
    expect(d).toEqual({ status: "VERIFIED", submitted: false, reopened: false });
  });

  it("shows what the old behaviour cost: a nulled CIN retires the approval", () => {
    // This is the bug, pinned so nobody reintroduces it by "simplifying" the
    // route back to nulling an absent field.
    const d = decideOrgStatus("VERIFIED", before, { ...COMPANY, cin: null });
    expect(d.reopened).toBe(true);
    expect(d.status).toBe("PENDING");
  });

  it("a nulled CIN also drops a pending company out of the queue", () => {
    const d = decideOrgStatus("PENDING", before, { ...COMPANY, cin: null });
    expect(d.status).toBe("NOT_SUBMITTED");
  });
});
