import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * With INVESTIGATOR_ENABLED off, POST /api/admin/fraud-investigations refuses
 * every run (409) — yet Risk & Compliance offered a live Investigate button on
 * every NGO alert, so the only thing it could ever do was show an error.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Risk & Compliance with the investigator switched off", () => {
  const page = src("app/admin/risk-compliance/page.tsx");
  const client = src("app/admin/risk-compliance/RiskComplianceClient.tsx");

  it("the page passes the server-side switch to the client", () => {
    expect(page).toMatch(/import \{ INVESTIGATOR_ENABLED \} from "@\/lib\/fraud-investigator\/config"/);
    expect(page).toMatch(/investigatorEnabled=\{INVESTIGATOR_ENABLED\}/);
  });

  it("Investigate is disabled, and explains why, when the switch is off", () => {
    expect(client).toMatch(/disabled=\{!investigatorEnabled \|\| investigatingId === alert\.id\}/);
    expect(client).toMatch(/AI investigation is off on this deployment/);
  });

  it("the badge does not promise an investigation that will never run", () => {
    expect(client).toMatch(/AI: investigator off — manual review/);
  });

  it("the client never reads the env var itself (it is undefined in the browser)", () => {
    expect(client).not.toMatch(/process\.env/);
  });
});
