export interface PanVerificationResult {
  valid: boolean;
  registeredName: string | null;
  error?: string;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

export function namesMatch(submittedOrgName: string, registeredName: string): boolean {
  const a = normalizeName(submittedOrgName);
  const b = normalizeName(registeredName);
  if (a === b) return true;
  // Allow one to be a substring of the other for abbreviations/short names
  if (a.includes(b) || b.includes(a)) return true;
  // Allow if they share at least 70% of significant words
  const wordsA = a.split(" ").filter(w => w.length > 2);
  const wordsB = new Set(b.split(" ").filter(w => w.length > 2));
  if (wordsA.length === 0 || wordsB.size === 0) return false;
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.size) >= 0.7;
}

export async function verifyPan(panNumber: string): Promise<PanVerificationResult> {
  const token = process.env.SUREPASS_API_TOKEN;

  // Mock mode — no token configured
  if (!token) {
    console.warn("[PAN Verification] SUREPASS_API_TOKEN not set — using mock (always valid)");
    return { valid: true, registeredName: null };
  }

  try {
    const { verifyPanSurepass } = await import("./providers/surepass");
    return await verifyPanSurepass(panNumber);
  } catch (err: any) {
    console.error("[PAN Verification] Provider error:", err.message);
    // Fail open — don't block registration if the external API is down
    return { valid: true, registeredName: null, error: err.message };
  }
}
