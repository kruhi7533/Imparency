import type { PanVerificationResult } from "../index";

export async function verifyPanSurepass(panNumber: string): Promise<PanVerificationResult> {
  const token = process.env.SUREPASS_API_TOKEN;
  if (!token) {
    throw new Error("SUREPASS_API_TOKEN not configured");
  }

  const response = await fetch("https://kyc-api.surepass.io/api/v1/pan/pan-comprehensive", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ id_number: panNumber })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Surepass API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  if (!data.success || !data.data) {
    return { valid: false, registeredName: null };
  }

  return {
    valid: true,
    registeredName: data.data.full_name || data.data.name || null
  };
}
